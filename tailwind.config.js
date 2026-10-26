/** @type {import('tailwindcss').Config} */
import tailwindcssAnimate from 'tailwindcss-animate'

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        paper:   '#F2F4F3',
        ink:     '#13233A',
        carbon:  '#2445D6',
        paid:    '#0B7A4B',
        amber:   '#9A5B00',
        rule:    '#CDD5DD',
        surface: '#FFFFFF',
      },
      fontFamily: {
        sans: ['"Schibsted Grotesk"', 'sans-serif'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to:   { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to:   { height: '0' },
        },
        // The Drop: a coin falls into the slot (sending), then lands and goes green (paid).
        'drop-fall': {
          '0%':   { transform: 'translateY(-16px)', opacity: '0' },
          '20%':  { transform: 'translateY(-10px)', opacity: '1' },
          '85%':  { transform: 'translateY(24px)',  opacity: '1' },
          '100%': { transform: 'translateY(24px)',  opacity: '0' },
        },
        'drop-land': {
          '0%':   { transform: 'translateY(-22px)', fill: '#2445D6' },
          '55%':  { transform: 'translateY(1.5px)', fill: '#2445D6' },
          '75%':  { transform: 'translateY(0)',     fill: '#2445D6' },
          '100%': { transform: 'translateY(0)',     fill: '#0B7A4B' },
        },
        'stamp-press': {
          '0%':   { transform: 'rotate(-8deg) scale(1.4)',  opacity: '0' },
          '55%':  { transform: 'rotate(-8deg) scale(0.93)', opacity: '0.85' },
          '75%':  { transform: 'rotate(-8deg) scale(1.04)', opacity: '0.85' },
          '100%': { transform: 'rotate(-8deg) scale(1)',    opacity: '0.85' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
        'drop-fall':      'drop-fall 1.1s cubic-bezier(0.55,0,1,0.45) infinite',
        'drop-land':      'drop-land 0.8s cubic-bezier(0.34,1.4,0.64,1) both',
        'stamp-press':    'stamp-press 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.35s both',
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
