const THEME_KEY = 'transit_theme';

function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem(THEME_KEY) || 'light';

    // Apply saved theme on page load
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        themeToggle.setAttribute('aria-pressed', 'true');
    }

    // Toggle theme when button is clicked
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
        themeToggle.setAttribute('aria-pressed', isDark);
    });
}

// Initialize theme when DOM is loaded
document.addEventListener('DOMContentLoaded', initTheme);
