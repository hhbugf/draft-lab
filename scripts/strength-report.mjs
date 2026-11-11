import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import '../dist/data/model.js';
import '../dist/engine.js';
import '../dist/analytics.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(root,'build');
const D=JSON.parse(fs.readFileSync(path.join(root,'dist/data/snapshot.json'))),M=globalThis.BP_MODEL,A=globalThis.BPAnalytics;
const s=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/weak-professional-lineup.json')));
s.note='截图十名已选英雄已核对；Ban头像未完整辨认，使用注明的合法Ban测试集。因此不把本测试63.7%与截图60.2%当成相同状态的前后对照。';
fs.writeFileSync(path.join(out,'截图阵容回归.json'),JSON.stringify(s,null,2));
const p=A.predict(s,D),v=M.validation.stages['20'],pct=n=>(n*100).toFixed(1)+'%';
fs.writeFileSync(path.join(out,'英雄强度修正核验.json'),JSON.stringify({modelVersion:M.version,sourceHash:M.dataHash,fixture:s,prediction:p,validation:M.validation.stages,acceptedAsPrimary:M.strengthExperimentPromoted},null,2));
const report=`# v0.4.0 英雄强度、样本外阵容与截图更正

截图蓝方是橘右京、鲁班七号、瑶、妲己、亚瑟。此前将橘右京误识别为铠的分析已撤回，并更正核验文档与机器数据。

当前237局快照中，各英雄选用与胜负以本报告附带画像及逐局数据为准。零出场英雄的胜率未知。不能把鲁班七号单局全胜理解为100%强度。

## 实际修改

1. 零训练出场英雄使单点统计胜率暂停突出展示，改为“样本外阵容”。保留旧统计模型对照，并逐人显示出场/胜场/Ban与证据等级。
2. 增加单独的职业需求/阵容结构先验实验，按分路归一职业需求，同时考虑先手和前排覆盖。没有为截图中的特定英雄写固定扣分。
3. 每个训练前缀的职业需求统计只来自该系列赛开始前已结束的系列赛；留出期间冻结训练期画像。历史主统计模型保持原有赛前口径。
4. 明示先验权重敏感范围、完整参数、画像、主模型/先验/队伍基线对比。先验实验没有通过总体预测准确性验收，因此不替代主模型。

## 已核验的测试结果

相同十名已选英雄、重庆狼队蓝方/深圳DYG红方、合法测试Ban集：

- 队伍基线：蓝方${pct(p.baseline)}。
- 原统计模型对照：蓝方${pct(p.blue)}，含3名零样本，暂停作为单点比赛胜率展示。
- 强度先验实验：蓝方${pct(p.priorBlue)}，红方${pct(p.priorRed)}。
- 蓝方先验权重敏感范围：${pct(p.sensitivity[0])}—${pct(p.sensitivity[1])}，不是置信区间。

**Ban头像未完整辨认，测试使用另列的合法Ban集。因此不能声称已精确复现截图的60.2%，或将其与${pct(p.priorBlue)}直接当作同一状态前后差值。**完整动作可在“截图阵容回归.json”检查并导入。

## 验收结果与限制

|完整BP，${M.validation.testGames}局留出|准确率|Brier（低优）|Log loss（低优）|
|---|---:|---:|---:|
|队伍基线|${pct(v.baseline.accuracy)}|${v.baseline.brier.toFixed(5)}|${v.baseline.logLoss.toFixed(5)}|
|保留的统计模型|${pct(v.draft.accuracy)}|${v.draft.brier.toFixed(5)}|${v.draft.logLoss.toFixed(5)}|
|强度先验实验|${pct(v.strengthExperiment.accuracy)}|${v.strengthExperiment.brier.toFixed(5)}|${v.strengthExperiment.logLoss.toFixed(5)}|

全局提高需求和结构权重并未提高回测准确性。该实验供样本外阵容的职业适配推演，不能称为真实校准胜率。当前${M.validation.testGames}局验收集已用于多个方案对比，未来需要未触碰的独立比赛验证，不能继续称为新方案的一次性盲测。

职业需求是（Pick + 0.5 Ban）/（局初可用机会 + 12），按同主分路至少3次出场英雄需求中位数转为 r/(r+median)，并乘 n/(n+24)。机会排除本队同系列已用英雄族，不声称排除本局后续Ban、占位或精确控制每手决策机会。固定系数先验为需求1.0、先手0.35、前排0.25；L2训练更新。需求低代表职业环境适配线索，不能等同因果弱势。

先手/前排使用现有0—5规则画像；部分为类型模板，非官方量化强度。它们不是当日历史版本快照，所以先验实验不能当成完全无未来知识的历史回测。概率训练排除1局顺序异常，画像出场统计1${M.validation.testGames}局；职业数据页官方汇总144局，两者分母明确区分。

尚未取得可核验的S45官方高分段全英雄强度数据；赛事服补丁未核验，不把10月15日起的日期窗口当成同补丁证明。未使用赛中经济、人头、伤害。

## 验证与复算

请运行测试与历史状态审计查看本次检查结果。本次更新未完成浏览器视觉复核：本机预览无法连接，本地文件被浏览器工具策略阻止；自动页面渲染和离线资源一致性已覆盖测试。

复算：Python + NumPy运行 scripts/train-model.py；Node运行 scripts/strength-report.mjs、node --test tests/*.test.mjs、node scripts/audit-data.mjs。测试状态位于 tests/fixtures/weak-professional-lineup.json。
`;
fs.writeFileSync(path.join(out,'英雄强度与样本外阵容修正说明.md'),report);
console.log(JSON.stringify({version:M.version,bluePrior:p.priorBlue,statistical:p.blue,unseen:p.coverage.map(c=>c.unseen),promoted:M.strengthExperimentPromoted}));
