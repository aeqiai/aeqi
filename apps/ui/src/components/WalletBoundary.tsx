import { Suspense, lazy } from "react";
import type { ReactNode } from "react";

const WalletProvider = lazy(() => import("@/components/WalletProvider"));

/**
 * Mount the wallet provider only around surfaces that call wagmi or
 * RainbowKit hooks. Keeping this out of main.tsx lets the app shell paint
 * without waiting for wallet SDK chunks.
 */
export default function WalletBoundary({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <WalletProvider>{children}</WalletProvider>
    </Suspense>
  );
}
