# 原文和检索

数据库默认位置为技能目录下的 `assets/corpus.sqlite3`。已有 `Cyber_Mao_Corpus.sqlite3` 时，复制到该位置，或以 `--db` 指定文件路径。程序以只读方式打开数据库。

从技能目录运行以下命令。Windows 可用 `py -3` 代替 `python3`。

```sh
python3 scripts/corpus.py works 论持久战
python3 scripts/corpus.py search 调查 事实 --limit 3
python3 scripts/corpus.py quote '没有调查，没有发言权' --source xuanji
python3 scripts/corpus.py read xuanji 1909 1912
python3 scripts/corpus.py verify
```

基准数据库包含 `xuanji`（《选集》）和 `wenji`（《文集》）。定位行号从各 TXT 第一行起算。默认检索范围为正文候选，排除附注、编者评论和静火私人补编。可用 `--include-supplementary` 检查补编，逐字查询可用 `--include-editorial` 纳入附注、评论和目录。布局标签及自动题名定位需要结合上下文核对。

如持有基准版 TXT，将它们命名为 `mao-xuanji.txt` 和 `mao-wenji.txt`，使用 `python3 scripts/build_corpus.py build --sources 原文目录 --out 输出目录` 生成数据库。构建程序检查基准版哈希。将生成的 `Cyber_Mao_Corpus.sqlite3` 接入上述位置。原著公开出处见[篇段表](modules-and-passages.md)，版本资料见[历史对照](history.md)。
