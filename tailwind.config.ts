import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f7f7f8',
          100: '#eeeef1',
          200: '#d8d9df',
          400: '#8b8d99',
          600: '#4b4d57',
          800: '#1e1f25',
          900: '#0e0f13',
        },
        accent: {
          DEFAULT: '#ff4e2c',
          soft: '#ff7a5c',
          dim: '#c93d20',
        },
      },
      fontFamily: {
        sans: ['"Inter"', '"SF Pro Display"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,16,20,0.04), 0 8px 24px rgba(15,16,20,0.06)',
        focus: '0 0 0 3px rgba(255,78,44,0.25)',
      },
    },
  },
  plugins: [],
} satisfies Config;
