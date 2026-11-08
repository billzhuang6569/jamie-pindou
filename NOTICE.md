# 第三方声明

Jamie的拼豆台按 [AGPL-3.0](LICENSE) 开源。项目用到的第三方内容如下，它们各自的许可继续有效。

## 色号数据

| 内容 | 来源 | 许可 |
| --- | --- | --- |
| COCO、漫漫、盼盼、咪小窝与 MARD 的色号对照表（`data/sources/colorSystemMapping.json`） | [Zippland/perler-beads](https://github.com/Zippland/perler-beads) | AGPL-3.0 |
| MARD、Hama Mini、Perler Mini、Artkal C 的色号和色值 | [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors) | MIT，见 [data/sources/beadcolors.LICENSE](data/sources/beadcolors.LICENSE) |

本项目对这些数据做的改动，写在 [data/sources/README.md](data/sources/README.md) 的“处理规则”里。

品牌名称归各自所有者所有。本项目与这些品牌没有关联，也没有得到它们的授权或背书。

## 字体

界面和导出的图纸使用 [Rubik](https://github.com/googlefonts/rubik) 字体，按 SIL Open Font License 1.1 授权，见 [licenses/Rubik-OFL.txt](licenses/Rubik-OFL.txt)。

## 代码依赖

运行时依赖 [React](https://github.com/facebook/react)（MIT）。完整依赖和许可信息见 `package.json` 和 `package-lock.json`。
