import { QRCodeSVG } from 'qrcode.react'
import { X, Copy, Check } from 'lucide-react'
import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { buildShareLink } from '@/lib/share'

interface QrModalProps {
  address: string
  label: string
  onClose: () => void
}

export function QrModal({ address, label, onClose }: QrModalProps) {
  const [copied, setCopied] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)

  useEffect(() => {
    void buildShareLink(`/slot/${address}`).then(setShareUrl)
  }, [address])

  const handleCopy = () => {
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
        <motion.div
          className="relative w-full max-w-sm mx-4 rounded-3xl p-6"
          style={{
            background: 'rgba(31,47,68,0.95)',
            backdropFilter: 'blur(40px)',
            border: '1px solid var(--border)',
          }}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-lg transition-colors"
            style={{ color: 'var(--subtle)' }}
          >
            <X className="size-5" />
          </button>

          <p className="text-sm font-medium mb-1" style={{ color: 'var(--subtle)' }}>
            Deposit address
          </p>
          <p className="font-semibold mb-4 truncate" style={{ color: 'var(--ink)' }}>
            {label}
          </p>

          {/* QR code */}
          <div className="flex justify-center mb-4">
            <div className="rounded-2xl p-4 bg-white">
              <QRCodeSVG value={shareUrl ?? address} size={200} />
            </div>
          </div>

          {/* Address */}
          <div
            className="rounded-2xl p-3 mb-3 break-all mono text-xs"
            style={{ background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
          >
            {address}
          </div>

          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold transition-all"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copied!' : 'Copy address'}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
