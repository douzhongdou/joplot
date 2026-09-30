# CSV 工作台壳层重构实施计划

## 目标

将当前界面重构为极简全视口工作台，支持全局拖拽上传 CSV，并让主视窗与右侧侧边栏拥有各自独立滚动区域。

## 任务拆分

### 任务 1：补上传交互测试

文件：

- Create: `tests/upload.test.ts`
- Create: `src/lib/upload.ts`

步骤：

- [ ] 为 CSV 文件识别、文件列表提取和导航栏提示文案编写失败测试
- [ ] 运行测试，确认因缺失实现而失败
- [ ] 实现最小上传辅助函数
- [ ] 重跑上传测试，确认通过

### 任务 2：重构上传入口与全局拖拽逻辑

文件：

- Modify: `src/App.tsx`
- Modify: `src/components/FileUploader.tsx`

步骤：

- [ ] 将上传组件改为极简 navbar 上传入口
- [ ] 在 `App` 中接入页面级拖拽进入、离开、释放逻辑
- [ ] 拖拽时显示全局蒙层，释放合法 CSV 后调用现有解析流程
- [ ] 保留点击上传作为补充入口

### 任务 3：重构全视口极简布局

文件：

- Modify: `src/App.tsx`
- Modify: `src/index.css`
- Review: `src/components/WorkbenchToolbar.tsx`
- Review: `src/components/FilterBar.tsx`
- Review: `src/components/CardInspector.tsx`

步骤：

- [ ] 将页面改成 `100vh` 应用壳
- [ ] 顶部改为单行全宽 navbar
- [ ] 主区与右侧 sidebar 改为填满剩余视口高度
- [ ] 左右两栏启用独立滚动
- [ ] 删除空态大文案和重装饰样式

### 任务 4：验证

步骤：

- [ ] 运行 `node --test tests/upload.test.ts`
- [ ] 运行 `node --test tests/workbench.test.ts`
- [ ] 运行 `pnpm exec tsc --noEmit`
- [ ] 运行 `pnpm build`

## 风险

- 浏览器拖拽事件容易重复触发，需要使用进入/离开计数或稳定状态判断，避免蒙层闪烁
- 极简样式如果改动过大，可能影响现有图卡交互区域，需要通过构建后页面验证确认
- 全视口布局中若某个父容器未设置 `min-height: 0`，独立滚动可能失效

## 验收标准

- 页面任意位置可拖拽上传 CSV
- 顶部只保留简洁提示，不再显示等待数据类胶囊
- 页面主体充满视口
- 左侧主视窗和右侧侧边栏独立滚动
- 视觉语言明显比当前更极简
