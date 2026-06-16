/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Brutalist / terminal palette
        void: '#0a0a0b',
        panel: '#111114',
        edge: '#1f1f24',
        ink: '#e6e6e6',
        muted: '#6b6b73',
        accent: '#00ff9c',
        danger: '#ff4d4d',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
