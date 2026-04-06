import { motion } from "framer-motion";
import Nav from "./Nav";
import Footer from "./Footer";

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 8 } as const,
  animate: { opacity: 1, y: 0 } as const,
  transition: { duration: 0.7, ease: [0.25, 0.1, 0.25, 1] as const, delay },
});

export default function Privacy() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Nav />
      <section className="flex-1 px-6 pt-28 pb-20">
        <motion.div className="max-w-2xl mx-auto" {...fade(0.1)}>
          <h1 className="text-[28px] font-semibold tracking-tight text-black/80">Privacy Policy</h1>
          <p className="mt-2 text-[14px] text-black/40">Last updated: April 2026</p>
          <div className="mt-10 space-y-6 text-[15px] leading-[1.8] text-black/60">
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">What we collect</h2>
            <p>When you create an account, we collect your email address and any information you provide during signup. When you use the Platform, we collect usage data including agent activity, token consumption, and session metadata.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">How we use it</h2>
            <p>We use your data to operate the Platform, process billing, improve our services, and communicate with you about your account. We do not sell your personal data to third parties.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">LLM data</h2>
            <p>Agent conversations and tool outputs are processed by third-party LLM providers (OpenRouter, Xiaomi). We send only the data necessary to generate responses. We do not use your agent data to train models.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">On-chain data</h2>
            <p>If you tokenize equity, cap table data is recorded on a public blockchain. On-chain data is immutable and cannot be deleted. Do not tokenize information you wish to keep private.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">Data retention</h2>
            <p>We retain your data for as long as your account is active. Upon account deletion, we remove your data within 30 days, except where required by law or where data exists on-chain.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">Security</h2>
            <p>We use industry-standard encryption for data in transit and at rest. Access to user data is restricted to authorized personnel only.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">Cookies</h2>
            <p>We use essential cookies for authentication and session management. No third-party tracking cookies are used.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">Your rights</h2>
            <p>You may request access to, correction of, or deletion of your personal data at any time by contacting <a href="mailto:privacy@aeqi.ai" className="text-black/80 underline">privacy@aeqi.ai</a>.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">Changes</h2>
            <p>We may update this policy at any time. We will notify you of material changes via email or through the Platform.</p>
          </div>
        </motion.div>
      </section>
      <div className="bg-[#fafafa]">
        <Footer />
      </div>
    </div>
  );
}
