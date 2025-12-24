#!/bin/bash
#
# 安装 Git hooks 脚本
# 用于设置自动版本更新功能
#

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
HOOKS_DIR="$PROJECT_ROOT/.git/hooks"
PRE_COMMIT_HOOK="$HOOKS_DIR/pre-commit"

# 检查是否在 Git 仓库中
if [ ! -d "$PROJECT_ROOT/.git" ]; then
    echo "❌ 错误: 当前目录不是 Git 仓库"
    exit 1
fi

# 创建 hooks 目录（如果不存在）
mkdir -p "$HOOKS_DIR"

# 创建 pre-commit hook
cat > "$PRE_COMMIT_HOOK" << 'EOF'
#!/bin/sh
#
# Git pre-commit hook: 自动更新版本号
# 每次提交代码时，自动递增 PATCH 版本号
#

# 获取项目根目录
ROOT_DIR=$(git rev-parse --show-toplevel)
VERSION_FILE="$ROOT_DIR/src/js/version.js"
UPDATE_SCRIPT="$ROOT_DIR/scripts/update-version.js"

# 检查是否有代码变更（排除版本文件本身）
if git diff --cached --name-only | grep -v "src/js/version.js" | grep -q "."; then
    # 有代码变更，更新版本号
    echo "📦 检测到代码变更，自动更新版本号..."
    
    # 运行版本更新脚本
    if [ -f "$UPDATE_SCRIPT" ]; then
        node "$UPDATE_SCRIPT"
        
        # 如果版本文件被修改，将其添加到暂存区
        if git diff --name-only | grep -q "src/js/version.js"; then
            git add "$VERSION_FILE"
            echo "✅ 版本号已更新并添加到提交中"
        fi
    else
        echo "⚠️  版本更新脚本不存在: $UPDATE_SCRIPT"
    fi
fi

exit 0
EOF

# 设置执行权限
chmod +x "$PRE_COMMIT_HOOK"

echo "✅ Git hooks 安装成功！"
echo ""
echo "📝 功能说明："
echo "   - 每次 git commit 时，会自动检测代码变更"
echo "   - 如果有代码变更，会自动递增 PATCH 版本号"
echo "   - 版本文件会自动添加到提交中"
echo ""
echo "🔧 Hook 位置: $PRE_COMMIT_HOOK"
echo ""
echo "💡 测试方法："
echo "   1. 修改任意代码文件"
echo "   2. git add ."
echo "   3. git commit -m '测试提交'"
echo "   4. 查看输出，应该会看到版本号更新信息"

