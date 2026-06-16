/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Brutalist / terminal palette, driven by CSS vars so the whole UI
        // (and the board background) follows the light/dark toggle.
        void: 'var(--c-void)',
        panel: 'var(--c-panel)',
        edge: 'var(--c-edge)',
        ink: 'var(--c-ink)',
        muted: 'var(--c-muted)',
        accent: 'var(--c-accent)',
        danger: 'var(--c-danger)',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
