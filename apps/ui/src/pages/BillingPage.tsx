import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { PLANS } from "../../../shared/pricing";

export default function BillingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const isTrialing = useAuthStore((s) => s.isTrialing);
  const trialDaysLeft = useAuthStore((s) => s.trialDaysLeft);
  const [loading, setLoading] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  useEffect(() => {
    if (searchParams.get("success") === "true") {
      setSuccess(true);
      const t = setTimeout(() => {
        fetchMe().then(() => navigate("/", { replace: true }));
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [searchParams, fetchMe, navigate]);

  const subscribe = async (plan: "starter" | "growth") => {
    setLoading(plan);
    try {
      const { url } = await api.createCheckoutSession(plan);
      window.location.href = url;
    } catch {
      setLoading(null);
    }
  };

  const manage = async () => {
    setLoading("portal");
    try {
      const { url } = await api.createPortalSession();
      window.location.href = url;
    } catch {
      setLoading(null);
    }
  };

  if (success) {
    return (
      <div className="bill">
        <div className="bill-success">
          <div className="bill-success-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 16l5 5 7-9" />
            </svg>
          </div>
          <p className="bill-success-title">You're all set</p>
          <p className="bill-success-sub">Redirecting to your dashboard...</p>
        </div>
      </div>
    );
  }

  const status = user?.subscription_status;
  const plan = user?.subscription_plan;
  const days = trialDaysLeft();
  const trialing = isTrialing();
  const expired = trialing && days === 0;

  return (
    <div className="bill">
      <div className="bill-header">
        <div>
          <h1 className="bill-title">Plans & Billing</h1>
          <p className="bill-subtitle">Simple, transparent pricing. Scale when you're ready.</p>
        </div>
        {status === "active" && plan && (
          <button className="bill-manage" onClick={manage} disabled={loading === "portal"}>
            {loading === "portal" ? "Opening..." : "Manage subscription"}
          </button>
        )}
      </div>

      {/* Status banner */}
      {trialing && (
        <div className={`bill-banner${expired ? " expired" : ""}`}>
          <div className="bill-banner-left">
            <span className="bill-banner-badge">{expired ? "Expired" : "Trial"}</span>
            <span className="bill-banner-text">
              {expired
                ? "Your free trial has ended. Choose a plan to continue."
                : `${days} day${days !== 1 ? "s" : ""} remaining on your free trial`}
            </span>
          </div>
        </div>
      )}

      {status === "active" && plan && (
        <div className="bill-banner active">
          <div className="bill-banner-left">
            <span className="bill-banner-badge active">{plan === "starter" ? "Starter" : "Growth"}</span>
            <span className="bill-banner-text">Your subscription is active</span>
          </div>
          <span className="bill-banner-price">${PLANS.find((p) => p.id === plan)?.price ?? "?"}/mo</span>
        </div>
      )}

      {status === "past_due" && (
        <div className="bill-banner expired">
          <div className="bill-banner-left">
            <span className="bill-banner-badge">Past due</span>
            <span className="bill-banner-text">Payment failed. Please update your payment method.</span>
          </div>
          <button className="bill-manage" onClick={manage} disabled={loading === "portal"}>
            Update payment
          </button>
        </div>
      )}

      {/* Plans */}
      <div className="bill-plans">
        {PLANS.map((p) => {
          const current = status === "active" && plan === p.id;
          return (
            <div key={p.id} className={`bill-card${p.popular ? " popular" : ""}${current ? " current" : ""}`}>
              {p.popular && <div className="bill-card-badge">Recommended</div>}
              <div className="bill-card-head">
                <h2 className="bill-card-name">{p.name}</h2>
                <p className="bill-card-desc">{p.desc}</p>
                <div className="bill-card-price">
                  <span className="bill-card-amount">${p.price}</span>
                  <span className="bill-card-period">/month</span>
                </div>
              </div>
              <div className="bill-card-divider" />
              <span className="bill-card-includes">What's included</span>
              <ul className="bill-card-features">
                {p.short.map((f) => (
                  <li key={f}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M4 8.5l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                className={`bill-card-cta${current ? " current" : ""}${p.popular && !current ? " primary" : ""}`}
                onClick={() => !current && subscribe(p.id)}
                disabled={current || loading === p.id}
              >
                {current ? "Current plan" : loading === p.id ? "Redirecting..." : p.popular ? "Get started" : "Choose Starter"}
              </button>
            </div>
          );
        })}
      </div>

      <p className="bill-footer">
        All prices in USD. Cancel anytime, no questions asked.
        <br />
        Need something custom? <a href="mailto:hello@aeqi.ai">Talk to us</a>
      </p>
    </div>
  );
}
