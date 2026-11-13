# 真实台球 3D · 联机版

把原来 1.6 MB 的单文件 HTML（内联 Three.js、物理、规则、音效）拆成了 Vue 3 + Vite 项目，并新增了联网对战。

## 运行

```bash
npm install
npm run dev:all
```

打开 http://localhost:5173 。`dev:all` 会同时启动：

- Vite 前端（5173）
- 联机服务（3210，前端通过 Vite 代理访问 `/ws`）

只启动其中一部分：

```bash
npm run dev      # 仅前端，本地双人可玩
npm run server   # 仅联机服务
```

## 生产部署

```bash
npm run build
npm start
```

`npm start` 会在 3210 端口同时提供构建后的静态页面和 WebSocket 服务（同源 `/ws`）。可用 `WS_PORT` 改端口：

```bash
WS_PORT=8080 npm start
```

## 联机对战

1. 菜单切换到「联网对战」。
2. 房主填昵称，在创建卡片里选择玩法（中式八球 / 斯诺克）和本局辅助线开关，点「创建房间」得到 5 位房间码。
3. 另一位玩家填写昵称并输入房间码加入。
4. 房主点「开始比赛」。之后只有轮到的玩家能瞄准、摆球和击球；辅助线开关以房主创建房间时的设置为准。
5. 非击球方的视角会实时跟随击球方：能看到对方当前的视角、瞄准方向、力度、球杆蓄力和自由球摆位，而不是停在固定画面。
6. 一局结束后双方点「再来一局」即可重新开球；对手离开会提示并返回大厅。

联机采用**服务端权威**：客户端只上报击球参数（角度、力度、旋转、自由球位置），服务器用同一套物理与规则模拟到静止，再把权威状态广播给双方。客户端本地也会播放同一杆的动画，结束后对齐服务器状态，避免两端物理漂移。

## 目录结构

```
index.html                  入口
src/
  main.js                   Vue 挂载
  App.vue                   页面骨架
  styles/main.css            原单文件样式 + 联机界面样式
  game/
    constants.js             球台尺寸、物理常量、球色
    geometry.js              球台几何、袋口、库边碰撞线段
    physics.js               纯物理：摩擦、碰撞、落袋、库边
    rules.js                 中式八球 / 斯诺克规则与结分
    match.js                 摆球、开杆、权威模拟、状态快照
    engine.js                Three.js 渲染、相机、瞄准与输入
    audio.js                 音频引擎（实录音效、空间声像）
    sounds.js                内嵌 PCM 实录音效数据
  composables/
    useBilliards.js          把引擎、UI 状态、联机状态串起来
  components/
    GameHud.vue              顶部比分、视角切换与设置入口
    PlayerCard.vue           玩家卡（球组、剩余球、得分）
    BallChip.vue             单颗球的标记
    TableStage.vue           3D 球桌、力度条
    SettingsPanel.vue        设置面板（辅助线 / 音效）
    ControlBar.vue           击点、微调、力度、击球
    SpinPad.vue              旋转击点圆盘
    ModeMenu.vue             开局 / 暂停 / 结算 / 联机入口
    OnlinePanel.vue          创建 / 加入房间、辅助线设置、座位与开始
  net/
    client.js                WebSocket 客户端与消息分发
server/
  index.js                   房间、回合校验、权威模拟、静态托管
scripts/
  dev-all.js                 同时启动前后端的开发脚本
真实台球3D.html               原始单文件版本，保留作参考
```

## 说明

- 中式八球：全色 / 花色分组，清完本组后打 8 号球；开球进球不定花色；犯规给对手自由球。
- 斯诺克：红彩交替、彩球复位、犯规罚分，按剩余彩球顺序收尾。
- 音效为原文件内嵌的实录音频（光厂），仅供个人非商业学习、研究与交流使用。
- 一个房间两名玩家，房间码 5 位；不保存历史战绩，服务端为内存房间。
