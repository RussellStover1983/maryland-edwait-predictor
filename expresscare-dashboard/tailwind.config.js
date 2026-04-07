/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0b10',
        panel: '#12141f',
        elevated: '#1a1d2e',
        border: '#252840',
        'text-primary': '#e2e8f0',
        'text-secondary': '#8892a8',
        'text-muted': '#4b5563',
        accent: '#3b82f6',
        live: '#22c55e',
        census: {
          1: '#22c55e',
          2: '#eab308',
          3: '#f97316',
          4: '#ef4444',
        },
        gap: '#f59e0b',
        competitor: '#4b5563',
      },
      fontFamily: {
        sans: ['Space Grotesk', 'DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-dot': 'pulse-dot 1.4s ease-in-out infinite',
        'gap-pulse': 'gap-pulse 2s ease-in-out infinite',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%, 100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        'gap-pulse': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
