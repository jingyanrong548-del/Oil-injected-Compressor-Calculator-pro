# 自动版本更新机制

## 概述

本项目已配置自动版本更新机制，**每次提交代码时，版本号会自动递增**。

## 工作原理

### Git Pre-commit Hook

在每次执行 `git commit` 时，会自动运行 `.git/hooks/pre-commit` 脚本：

1. **检测代码变更**：检查是否有除版本文件外的代码变更
2. **自动更新版本号**：如果有代码变更，自动递增 PATCH 版本号（例如：7.2.2 → 7.2.3）
3. **自动添加到提交**：将更新后的版本文件自动添加到本次提交中

### 版本号规则

遵循语义化版本号（Semantic Versioning）：
- **MAJOR**：重大变更（不兼容的 API 修改）
- **MINOR**：新功能（向后兼容的功能性新增）
- **PATCH**：问题修正（向后兼容的 bug 修复）

**当前自动更新的是 PATCH 版本号**，适合日常代码改动。

## 安装（首次使用或新团队成员）

### 方式 1：自动安装（推荐）

运行安装脚本：

```bash
./scripts/install-git-hooks.sh
```

### 方式 2：手动安装

如果自动安装失败，可以手动设置：

```bash
# 1. 确保 hooks 目录存在
mkdir -p .git/hooks

# 2. 复制 pre-commit hook（hook 内容见下方）
# 或直接运行安装脚本

# 3. 设置执行权限
chmod +x .git/hooks/pre-commit
```

## 使用方式

### 正常提交代码

```bash
# 1. 修改代码
vim src/js/mode3_two_stage_gas.js

# 2. 添加文件到暂存区
git add .

# 3. 提交（会自动更新版本号）
git commit -m "修复中间温度显示问题"

# 输出示例：
# 📦 检测到代码变更，自动更新版本号...
# ✅ 版本号已自动更新: v7.2.2 → v7.2.3
# ✅ 版本号已更新并添加到提交中
```

### 手动更新版本号

如果需要手动更新 MAJOR 或 MINOR 版本号：

```bash
# 更新 PATCH 版本号
npm run version:patch

# 或直接编辑 src/js/version.js
# 修改 major、minor、patch 的值
```

## 版本文件位置

- **版本号定义**：`src/js/version.js`
- **更新脚本**：`scripts/update-version.js`
- **Git Hook**：`.git/hooks/pre-commit`

## 注意事项

1. **首次使用**：如果 Git hook 没有执行权限，需要运行：
   ```bash
   chmod +x .git/hooks/pre-commit
   ```

2. **跳过版本更新**：如果需要跳过自动版本更新（不推荐），可以使用：
   ```bash
   git commit --no-verify -m "提交信息"
   ```

3. **版本号格式**：版本号格式为 `vMAJOR.MINOR.PATCH`（例如：v7.2.3）

4. **构建时也会更新**：`npm run build` 时也会自动更新版本号（通过 package.json 中的 build 脚本）

## 版本号显示位置

版本号会在以下位置显示：
- 页面标题（如果配置了）
- 控制台输出
- 构建信息

## 故障排除

### Hook 不执行

如果 Git hook 没有执行：

1. **检查文件权限**：
   ```bash
   ls -l .git/hooks/pre-commit
   # 应该显示 -rwxr-xr-x
   ```

2. **重新设置权限**：
   ```bash
   chmod +x .git/hooks/pre-commit
   ```

3. **检查文件路径**：
   确保在项目根目录执行 `git commit`

### 版本号未更新

如果版本号没有自动更新：

1. **检查是否有代码变更**：只有代码变更才会触发版本更新
2. **检查脚本路径**：确保 `scripts/update-version.js` 存在
3. **查看错误信息**：Git commit 时会显示错误信息

## 示例工作流程

```bash
# 1. 修改代码
vim src/js/mode3_two_stage_gas.js

# 2. 查看变更
git status

# 3. 添加文件
git add src/js/mode3_two_stage_gas.js

# 4. 提交（自动更新版本号）
git commit -m "添加后冷却器选型参数"

# 输出：
# 📦 检测到代码变更，自动更新版本号...
# ✅ 版本号已自动更新: v7.2.2 → v7.2.3
# ✅ 版本号已更新并添加到提交中
# [main abc1234] 添加后冷却器选型参数
#  2 files changed, 50 insertions(+)
#  src/js/mode3_two_stage_gas.js
#  src/js/version.js

# 5. 推送
git push
```

## 总结

✅ **自动版本更新已启用**
- 每次 `git commit` 时自动更新 PATCH 版本号
- 版本文件自动包含在提交中
- 无需手动操作

📝 **版本号管理**
- 遵循语义化版本号规则
- 当前版本：查看 `src/js/version.js`
- 历史版本：查看 Git 提交历史

