# 色号数据来源

`npm run palettes` 读取这个目录，生成 `src/data/palettes.json`。文件都固定到具体提交，不会自动更新。

| 文件 | 内容 | 来源 | 许可 |
| --- | --- | --- | --- |
| `mard.csv` | MARD 291 色 | [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors) `gen/v1`，提交 `f97ff4283d03cef5cd7e1071a86f5892e0c0c61b` | MIT，见 `beadcolors.LICENSE` |
| `hama_mini.csv` | Hama Mini 78 色 | 同上 | MIT |
| `perler_mini.csv` | Perler Mini 41 色 | 同上 | MIT |
| `artkal_c.csv` | Artkal C 174 色（2.6mm） | 同上 | MIT |
| `colorSystemMapping.json` | COCO、漫漫、盼盼、咪小窝与 MARD 的色号对照 | [Zippland/perler-beads](https://github.com/Zippland/perler-beads) `src/app/colorSystemMapping.json`，提交 `2efee730f73dd4eb472ebde443a022d11f98bc21` | AGPL-3.0 |

## 许可

`colorSystemMapping.json` 来自 AGPL-3.0 项目，因此本项目整体按 AGPL-3.0 开源，见根目录的 [LICENSE](../../LICENSE) 和 [NOTICE.md](../../NOTICE.md)。

## 处理规则

- 对照表里的 MARD 色号写法（如 `A01`）统一改为 `A1`，屏幕色值改用 beadcolors 的版本。
- 色值只是屏幕近似。这些数据没有和实物色卡核对过，大量买豆前请对照实物。
- MARD 的 H1 是透明豆。Hama 的透明、荧光、夜光等特殊豆可以手动选用，但不参与自动匹配。
- 对照表里漫漫有两个颜色共用色号 S4，图纸上分不清，所以只保留第一个，共 290 色。
- Perler 的色号都以 `80-` 开头，为了放进图纸的小格子，统一去掉这个前缀。
- COCO、漫漫、盼盼、咪小窝的屏幕色值沿用对应的 MARD 色值。
