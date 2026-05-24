import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Status palette (legacy)
        supporter: '#16a34a',
        nonsupporter: '#dc2626',
        undecided: '#6b7280',
        // TechPigeon / Smart Nigraan brand tokens
        navy: {
          DEFAULT: '#0B1D3A',
          600: '#1E3A5F'
        },
        gold: {
          DEFAULT: '#BBA442',
          dark: '#9A8735',
          soft: '#F5EDC8'
        },
        sky: {
          brand: '#5CC4EB'
        },
        cream: '#FAF8F0'
      },
      fontFamily: {
        urdu: ['"Jameel Noori Nastaleeq"', '"Noto Nastaliq Urdu"', 'serif'],
        sans: ['Inter', '"Segoe UI"', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        brand: '0 18px 40px rgba(11,29,58,.30)',
        card: '0 12px 40px rgba(15,23,42,0.08)'
      }
    }
  },
  plugins: []
};

export default config;
