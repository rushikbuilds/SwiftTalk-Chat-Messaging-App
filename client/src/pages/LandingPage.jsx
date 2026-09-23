import React from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import "./LandingPage.css";

const features = [
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
        ),
        title: "Real-Time Messaging",
        desc: "Instant delivery with live read receipts, typing indicators, and seamless group chats.",
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4l3 3" />
            </svg>
        ),
        title: "AI-Powered Chat",
        desc: "Ask questions, summarize conversations, and get smart replies with built-in AI assistance.",
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
            </svg>
        ),
        title: "Rich Media & Files",
        desc: "Share photos, documents, and large files seamlessly with instant previews and chunked uploads.",
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6.002 6.002 0 0 0-4-5.659V5a2 2 0 1 0-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
            </svg>
        ),
        title: "Smart Notifications",
        desc: "Push notifications that keep you in the loop without overwhelming your focus.",
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
            </svg>
        ),
        title: "File & Media Sharing",
        desc: "Send images, documents, and files effortlessly with instant previews.",
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
        ),
        title: "Private & Secure",
        desc: "JWT authentication, OTP verification, and blocked-user controls keep your data safe.",
    },
];

export default function LandingPage() {
    const navigate = useNavigate();

    return (
        <>
            <Helmet>
                <title>SwiftTalk - Real Time Chat Messaging App</title>
                <meta name="description" content="Chat, connect, and collaborate with SwiftTalk." />
                <meta property="og:title" content="SwiftTalk - Real Time Chat Messaging App" />
                <meta property="og:description" content="Chat, connect, and collaborate with SwiftTalk." />
            </Helmet>
            <div className="lp-root">
                {/* ── NAV ── */}
                <nav className="lp-nav">
                    <div className="lp-nav-inner">
                        <div className="lp-logo">
                            <span className="lp-logo-icon">
                                <img src="/logo192.png" alt="Logo" />
                            </span>
                            <span className="lp-logo-text">SwiftTak</span>
                        </div>
                        <div className="lp-nav-cta">
                            <button className="lp-btn lp-btn-ghost" onClick={() => navigate("/login")}>
                                Log In
                            </button>
                            <button className="lp-btn lp-btn-primary" onClick={() => navigate("/register")}>
                                Sign Up Free
                            </button>
                        </div>
                    </div>
                </nav>

                {/* ── HERO ── */}
                <section className="lp-hero">
                    <div className="lp-hero-glow" />
                    <div className="lp-hero-content">
                        <div className="lp-badge">✦ Next-gen messaging, powered by AI</div>
                        <h1 className="lp-hero-title">
                            Connect, Chat &amp; <br />
                            <span className="lp-gradient-text">Collaborate</span>
                        </h1>
                        <p className="lp-hero-sub">
                            SwiftTalk brings real-time messaging, AI assistance, rich media sharing,
                            and smart notifications into one beautifully simple app.
                        </p>
                        <div className="lp-hero-actions">
                            <button
                                className="lp-btn lp-btn-primary lp-btn-lg"
                                onClick={() => navigate("/register")}
                            >
                                Get Started — It's Free
                                <svg viewBox="0 0 20 20" fill="currentColor" className="lp-arrow">
                                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                </svg>
                            </button>
                            <button
                                className="lp-btn lp-btn-outline lp-btn-lg"
                                onClick={() => navigate("/login")}
                            >
                                Log In to Your Account
                            </button>
                        </div>
                    </div>
                </section>

                {/* ── FEATURES ── */}
                <section className="lp-features">
                    <div className="lp-section-inner">
                        <p className="lp-section-eyebrow">Everything you need</p>
                        <h2 className="lp-section-title">Built for modern conversations</h2>
                        <div className="lp-features-grid">
                            {features.map((f, i) => (
                                <div className="lp-feature-card" key={i}>
                                    <div className="lp-feature-icon">{f.icon}</div>
                                    <h3>{f.title}</h3>
                                    <p>{f.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ── FOOTER ── */}
                <footer className="lp-footer">
                    <div className="lp-nav-inner">
                        <div className="lp-logo">
                            <span className="lp-logo-icon">
                                <img src="/logo192.png" alt="Logo" />
                            </span>
                            <span className="lp-logo-text">SwiftTak</span>
                        </div>
                        <p className="lp-footer-copy">© {new Date().getFullYear()} SwiftTak. All rights reserved.</p>
                    </div>
                </footer>
            </div>
        </>
    );
}
