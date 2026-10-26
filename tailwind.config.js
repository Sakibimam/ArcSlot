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
        paper:   '#ECEEE4',
        ink:     '#12352B',
        carbon:  '#2F6B57',
        serial:  '#C8372D',
        paid:    '#1E7A4C',
        amber:   '#9A5B00',
        rule:    '#C5CCBA',
        surface: '#F7F7EF',
      },
      fontFamily: {
        sans: ['Archivo', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        dot:  ['DotGothic16', 'ui-monospace', 'monospace'],
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
        // The payment animation: paper feeds at the slot (sending), then the
        // receipt prints out (paid). Stepped, like a thermal printer.
        'receipt-feed': {
          '0%, 100%': { transform: 'translateY(-36px)' },
          '50%':      { transform: 'translateY(-28px)' },
        },
        'receipt-print': {
          '0%':   { transform: 'translateY(-48px)' },
          '100%': { transform: 'translateY(0)' },
        },
        // Landing receipt: prints out of the slot, then gets its *PAID*.
        'receipt-unroll': {
          '0%':   { clipPath: 'inset(0 0 100% 0)' },
          '100%': { clipPath: 'inset(0 0 0 0)' },
        },
        'stamp-in': {
          '0%':   { opacity: '0', transform: 'scale(1.25)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
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
        'receipt-feed':   'receipt-feed 0.9s steps(4, end) infinite',
        'receipt-print':  'receipt-print 1.1s steps(12, end) both',
        'receipt-unroll': 'receipt-unroll 1.4s steps(14, end) 0.2s both',
        'stamp-in':       'stamp-in 0.3s cubic-bezier(0.34,1.56,0.64,1) 1.7s both',
        'stamp-press':    'stamp-press 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.35s both',
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
