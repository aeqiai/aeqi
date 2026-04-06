import { motion } from "framer-motion";
import Nav from "./Nav";
import Footer from "./Footer";

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 8 } as const,
  animate: { opacity: 1, y: 0 } as const,
  transition: { duration: 0.7, ease: [0.25, 0.1, 0.25, 1] as const, delay },
});

export default function Terms() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Nav />
      <section className="flex-1 px-6 pt-28 pb-20">
        <motion.div className="max-w-2xl mx-auto" {...fade(0.1)}>
          <h1 className="text-[28px] font-semibold tracking-tight text-black/80">Terms of Service</h1>
          <p className="mt-2 text-[14px] text-black/40">Last updated: April 2026</p>
          <div className="mt-10 space-y-6 text-[15px] leading-[1.8] text-black/60">
            <p>By accessing or using aeqi.ai ("the Platform"), you agree to be bound by these terms. If you do not agree, do not use the Platform.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">1. Service Description</h2>
            <p>AEQI provides an agent orchestration platform that enables users to create and manage autonomous companies powered by AI agents, with optional tokenized equity on-chain.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">2. Accounts</h2>
            <p>You must provide accurate information when creating an account. You are responsible for maintaining the security of your account credentials and for all activity under your account.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">3. Billing</h2>
            <p>Paid plans are billed monthly. You may cancel at any time. Cancellation takes effect at the end of the current billing period. No refunds for partial months.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">4. LLM Token Usage</h2>
            <p>Each plan includes a monthly token allocation. Additional tokens may be purchased or you may use your own API keys. Token allocations reset monthly and do not roll over.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">5. Acceptable Use</h2>
            <p>You may not use the Platform for any unlawful purpose, to harass or harm others, to distribute malware, or to infringe on intellectual property rights. We reserve the right to suspend accounts that violate these terms.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">6. Intellectual Property</h2>
            <p>You retain ownership of all content and data you create on the Platform. We do not claim any rights to your companies, agents, or configurations.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">7. Limitation of Liability</h2>
            <p>The Platform is provided "as is" without warranties of any kind. AEQI shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Platform.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">8. Changes</h2>
            <p>We may update these terms at any time. Continued use of the Platform after changes constitutes acceptance of the updated terms.</p>
            <h2 className="text-[17px] font-semibold text-black/80 pt-4">9. Contact</h2>
            <p>Questions about these terms may be directed to <a href="mailto:legal@aeqi.ai" className="text-black/80 underline">legal@aeqi.ai</a>.</p>
          </div>
        </motion.div>
      </section>
      <div className="bg-[#fafafa]">
        <Footer />
      </div>
    </div>
  );
}
