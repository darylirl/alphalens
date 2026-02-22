import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'Ubuntu', 'Helvetica Neue', 'sans-serif'],
        display: ['Teodor', 'Georgia', 'Garamond', 'serif'],
        mono: ['JetBrains Mono', 'IBM Plex Mono', 'monospace'],
      },
      colors: {
        bg: '#010E0C',
        surface: '#072724',
        elevated: '#0C302C',
        hover: '#0F3D38',
        border: '#0D2E2A',
        accent: '#34EAB9',
        danger: '#FF3B5C',
        'text-primary': '#F0FAF8',
        'text-secondary': '#8AADA9',
        'text-muted': '#4A706C',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { transform: 'translateY(16px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
      }
    }
  },
  plugins: []
}

export default config
