export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
    
    container.appendChild(toast);
    
    // 触发动画
    setTimeout(() => toast.classList.add('show'), 10);
    
    // 自动移除
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 2500);
}

export function setButtonLoading(buttonId, loading, originalText) {
    const btn = typeof buttonId === 'string' ? document.getElementById(buttonId) : buttonId;
    if (!btn) return;
    
    if (loading) {
        // 保存原始文字
        if (!btn.dataset.originalText) {
            btn.dataset.originalText = originalText || btn.textContent.trim();
        }
        btn.classList.add('loading');
        btn.disabled = true;
        // Loading 状态下文字会变透明，显示旋转图标
        btn.textContent = '处理中...';
    } else {
        // 恢复按钮状态
        btn.classList.remove('loading');
        btn.disabled = false;
        const restoreText = btn.dataset.originalText || originalText;
        if (restoreText) {
            btn.textContent = restoreText;
            delete btn.dataset.originalText;
        }
    }
}
