"""Reproducible BP-only ridge logistic model. Never consumes in-game statistics.
Each training game's 21 BP prefixes share total weight 1; holdout is whole series.
Penalties are fixed a priori, not selected against the reported holdout.
"""
import json, math, hashlib
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
raw = (ROOT/'dist/data/snapshot.json').read_bytes()
D = json.loads(raw)
games = sorted([g for g in D['games'] if g['sequenceValid']], key=lambda g:(g['date'],g['matchId'],g['seq']))
names = {h['name']:h['id'] for h in D['heroes']}
teams = [str(t['id']) for t in D['teams']]
heroes = [h['id'] for h in D['heroes']]
relations = [
 {'type':'ally','ids':[names['钟馗'],names['小乔']], 'label':'钟馗 + 小乔'},
 {'type':'ally','ids':[names['狄仁杰'],names['元流之子(辅助)'],names['嬴政']], 'label':'狄仁杰 + 元辅 + 嬴政'},
 {'type':'enemy','ids':[names['钟无艳'],names['镜']], 'label':'钟无艳 对 镜'},
 {'type':'enemy','ids':[names['项羽'],names['关羽']], 'label':'项羽 对 关羽'},
]
legacy_features = ['side']+['team:'+x for x in teams]+['pick:'+str(x) for x in heroes]+['ban:'+str(x) for x in heroes]+['relation:'+str(i) for i in range(len(relations))]
features = legacy_features+['strength:priority','structure:engage','structure:frontline']
ix={k:i for i,k in enumerate(features)}
penalty=np.array([4 if k=='side' else 2 if k.startswith('team:') else 12 if k.startswith('pick:') else 24 for k in features],float)
base_size=1+len(teams)
coefficient_prior=np.zeros(len(features))
# Coach priors are disclosed assumptions, not empirical causal coefficients.
# Fixed before evaluating the holdout; never special-case a named hero/fixture.
for k,v in [('strength:priority',1.0),('structure:engage',.35),('structure:frontline',.25)]:coefficient_prior[ix[k]]=v
penalty[ix['strength:priority']]=16
hero_index={h['id']:h for h in D['heroes']}
series={}
for g in games:series.setdefault(g['matchId'],[]).append(g)
ordered=sorted(series,key=lambda k:min(g['date'] for g in series[k]))
prior_sets={k:{g['id'] for g in games if max(z['date'] for z in series[g['matchId']])<min(z['date'] for z in series[k])} for k in ordered}

def strength_profile(gs):
 subset=[g for g in games if g['id'] in gs]
 counts={h:{'picks':0,'wins':0,'bans':0,'opportunities':0,'roles':{}} for h in heroes}
 for g in subset:
  for c in [1,2]:
   tid=str(g['blue' if c==1 else 'red']['id'])
   spent={hero_index[p['hero']]['family'] for old in D['games'] if old['matchId']==g['matchId'] and old['seq']<g['seq'] for p in old['players'] if str(p['teamId'])==tid} if g['seq']!=7 else set()
   for h in heroes:
    if hero_index[h]['family'] not in spent:counts[h]['opportunities']+=1
  for p in g['players']:
   r=counts[p['hero']];r['picks']+=1;r['wins']+=int(p['camp']==g['winCamp']);r['roles'][p['role']]=r['roles'].get(p['role'],0)+1
  for a in g['actions']:
   if a['type']=='ban':counts[a['hero']]['bans']+=1
 rates={h:(r['picks']+.5*r['bans'])/(r['opportunities']+12) for h,r in counts.items()}
 roles={h:max(r['roles'],key=r['roles'].get) if r['roles'] else hero_index[h]['roles'][0] for h,r in counts.items()}
 refs={role:float(np.median([rates[h] for h,r in counts.items() if r['picks']>=3 and roles[h]==role])) if any(r['picks']>=3 and roles[h]==role for h,r in counts.items()) else .1 for role in D['meta']['roles']}
 for h,r in counts.items():
  r['role']=roles[h];r['demand']=rates[h];r['priority']=rates[h]/(rates[h]+refs.get(roles[h],.1)) if rates[h] else 0
 return {'n':len(subset),'scale':len(subset)/(len(subset)+24),'through':max([g['date'] for g in subset],default=None),'heroes':counts,'roleReferences':refs}

profiles={k:strength_profile(gs) for k,gs in prior_sets.items()}

def strength_vector(actions,profile):
 out={'strength:priority':0.,'structure:engage':0.,'structure:frontline':0.}
 for c in [1,2]:
  ids=[a['hero'] for a in actions if a['type']=='pick' and a['camp']==c];sign=1 if c==1 else -1
  out['strength:priority']+=sign*sum(profile['heroes'][h]['priority']-.5 for h in ids)/5
  # Coarse mechanism priors only. Type templates are not official measured abilities.
  out['structure:engage']+=sign*min(1,sum(hero_index[h]['abilities']['engage']>=4 and hero_index[h]['abilities']['control']>=3 for h in ids))
  out['structure:frontline']+=sign*min(1,sum(hero_index[h]['abilities']['tank']>=4 for h in ids))
 return {k:v*profile['scale'] for k,v in out.items()}

def vector(g, n=20, profile=None):
 x=np.zeros(len(features)); x[0]=1
 x[ix['team:'+str(g['blue']['id'])]]+=1; x[ix['team:'+str(g['red']['id'])]]-=1
 p={1:set(),2:set()}
 for a in g['actions'][:n]:
  x[ix[a['type']+':'+str(a['hero'])]]+=1 if a['camp']==1 else -1
  if a['type']=='pick':p[a['camp']].add(a['hero'])
 for j,r in enumerate(relations):
  v=0
  for c in [1,2]:
   hit=all(h in p[c] for h in r['ids']) if r['type']=='ally' else r['ids'][0] in p[c] and r['ids'][1] in p[3-c]
   if hit:v+=1 if c==1 else -1
  x[ix['relation:'+str(j)]]=v
 for k,v in strength_vector(g['actions'][:n],profile or profiles[g['matchId']]).items():x[ix[k]]=v
 return x

X=np.array([vector(g,n) for g in games for n in range(21)])
y=np.array([int(g['winCamp']==1) for g in games for n in range(21)])
def sigmoid(z):return 1/(1+np.exp(-np.clip(z,-35,35)))
def fit(gs, baseline=False, legacy=False):
 indices=[i*21+n for i,g in enumerate(games) if g['id'] in gs for n in range(21)]
 size=base_size if baseline else len(legacy_features) if legacy else len(features)
 if not indices:return np.zeros(len(features))
 x=X[indices,:size]; t=y[indices]; center=np.zeros(size) if baseline or legacy else coefficient_prior[:size];w=center.copy(); reg=penalty[:size]
 for _ in range(15):
  p=sigmoid(x@w); gradient=x.T@(p-t)/21+reg*(w-center)
  hessian=(x.T*(p*(1-p)/21))@x+np.diag(reg)
  delta=np.linalg.solve(hessian,gradient); w-=delta
  if np.max(np.abs(delta))<1e-8:break
 return np.pad(w,(0,len(features)-size))

def model(gs):
 subset=[g for g in games if g['id'] in gs]
 return {'n':len(subset),'series':len(set(g['matchId'] for g in subset)), 'through':max([g['date'] for g in subset],default=None),
         'weights':fit(gs,legacy=True).round(9).tolist(),'baseline':fit(gs,True).round(9).tolist(),'candidateWeights':fit(gs).round(9).tolist(),'strengthProfile':strength_profile(gs)}

series={}
for g in games:series.setdefault(g['matchId'],[]).append(g)
ordered=sorted(series,key=lambda k:min(g['date'] for g in series[k]))
cut=math.floor(len(ordered)*.7)
cut_date=min(g['date'] for k in ordered[cut:] for g in series[k])
train=[g for g in games if max(z['date'] for z in series[g['matchId']])<cut_date]
test=[g for g in games if g['matchId'] in ordered[cut:]]
m=model({g['id'] for g in train})
def metrics(w,n):
 p=np.array([float(sigmoid(vector(g,n,m['strengthProfile'])@w)) for g in test]);t=np.array([int(g['winCamp']==1) for g in test])
 return {'n':len(t),'accuracy':float(np.mean((p>=.5)==t)),'brier':float(np.mean((p-t)**2)), 'logLoss':float(-np.mean(t*np.log(p)+(1-t)*np.log(1-p)))}
validation={'method':'按系列赛开始时间划分前70%训练、后30%留出；训练系列赛结束时间早于留出开始；无同系列赛跨集合；固定正则，无留出调参。',
 'trainGames':len(train),'trainSeries':len(set(g['matchId'] for g in train)), 'testGames':len(test),'testSeries':len(set(g['matchId'] for g in test)),
 'cutoff':cut_date,'model':m,'trainIds':[g['id'] for g in train],'testIds':[g['id'] for g in test],
 'stages':{str(n):{'draft':metrics(np.array(m['weights']),n),'strengthExperiment':metrics(np.array(m['candidateWeights']),n),'baseline':metrics(np.array(m['baseline']),n),'coin':{'brier':.25,'logLoss':math.log(2)}} for n in [0,10,20]}}
rolling={}
for k in ordered:
 start=min(g['date'] for g in series[k])
 prior={g['id'] for g in games if max(z['date'] for z in series[g['matchId']])<start}
 rolling[k]=model(prior)
 print('as-of',k,len(prior),flush=True)
artifact={'version':'0.4.0','dataHash':hashlib.sha256(raw).hexdigest(),'features':features,'relations':relations,'penalties':penalty.tolist(),'coefficientPriors':coefficient_prior.tolist(),
 'strengthPolicy':{'version':1,'presentation':'零训练出场英雄使单点统计胜率暂停展示；先验实验单独标注，不替代统计模型。低样本阈值6只用于证据提示。','opportunity':'每局开局双方可用池机会，排除该队全局已用英雄族；未排除本局后续Ban或占位，不能解释为决策时条件选择率。','demand':'(Pick + 0.5 Ban)/(局初可用机会 + 12)，再以同主分路至少3次出场英雄需求中位数归一为 r/(r+median)。Ban归入需求，不当作胜负。','scale':'历史样本局数/(局数+24)；每个训练前缀仅使用该系列赛开始前已结束系列赛的需求，留出期冻结训练期画像。','priors':'职业需求系数先验1.0；群体先手覆盖0.35；前排覆盖0.25。L2回归更新；需求正则16、结构24。属于显式教练假设，未见英雄预测不可视为已验证胜率。','structure':'先手覆盖 engage≥4且control≥3；前排覆盖tank≥4；每侧最多一份覆盖。来源是规则画像，非官方量化能力。','sensitivity':'将职业需求和结构项系数同时乘0.5或1.5得到先验权重敏感性区间，不是置信区间。'},
 'strengthExperimentPromoted':False,
 'method':'主统计模型保留队伍差、选边、已选/已Ban及四项关系的L2逻辑回归；另训练显式职业需求/先手/前排系数先验实验，未通过准确性验收，不替代主统计模型。每局21个前缀合计权重1。',
 'exclusions':'1局BP原始顺序异常排除建模；不使用人头、经济、伤害、时长或赛后字段；未单独估计选手实力；无实时对局遥测。',
 'full':model({g['id'] for g in games}),'rolling':rolling,'validation':validation}
(ROOT/'dist/data/model.json').write_text(json.dumps(artifact,ensure_ascii=False,separators=(',',':')),encoding='utf8')
(ROOT/'dist/data/model.js').write_text('globalThis.BP_MODEL='+json.dumps(artifact,ensure_ascii=False,separators=(',',':'))+';',encoding='utf8')
print(json.dumps({'validation':{k:v for k,v in validation.items() if k not in ['model','trainIds','testIds']},'newCoefficients':artifact['full']['candidateWeights'][-3:]},ensure_ascii=False,indent=2))
