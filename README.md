# Jamie的拼豆台

在手机浏览器里，把一张图片变成每格带色号、可以照着拼的拼豆图纸。图片只在本机处理，不上传，没有后端。尺寸都按 2.6mm 的豆子计算。

在线使用：<https://jamie-pindou.vercel.app>

## 运行

```bash
npm install
npm run dev
```

开发服务器监听局域网，手机连同一个 Wi-Fi 后，打开终端显示的 Network 地址即可。

```bash
npm test
npm run build
```

构建产物在 `dist/`，是纯静态文件，放到任何静态托管上都能运行。系统分享面板只在 HTTPS 下可用，HTTP 下保存图纸会改为直接下载。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/core/` | 与界面无关的逻辑：色差、取色匹配、颜色合并、图纸编辑、绘制和导出 |
| `src/ui/` | 页面和组件 |
| `src/storage.ts` | 本机保存，页面被系统回收后能恢复 |
| `data/sources/` | 固定版本的色号源数据及其来源说明 |
| `scripts/build-palettes.mjs` | 把源数据生成为 `src/data/palettes.json` |

## 许可

Copyright (C) 2026 billzhuang6569

本项目按 [AGPL-3.0](LICENSE) 开源。如果你修改后把它作为网络服务提供给别人使用，也要向这些用户提供修改后的源代码。第三方内容的来源和许可见 [NOTICE.md](NOTICE.md)。
