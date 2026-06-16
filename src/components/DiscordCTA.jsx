import { DISCORD_URL } from '../lib/constants'

export default function DiscordCTA() {
  return (
    <a
      href={DISCORD_URL}
      target="_blank"
      rel="noreferrer"
      className="rounded border border-[#5865F2] bg-[#5865F2]/10 px-3 py-1.5 text-xs tracking-wider text-[#9ba3ff] transition hover:bg-[#5865F2]/20"
    >
      JOIN THE DISCORD → coordinate your team
    </a>
  )
}
