import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        supporter: '#16a34a',
        nonsupporter: '#dc2626',
        undecided: '#6b7280'
      }
    }
  },
  plugins: []
};

export default config;
