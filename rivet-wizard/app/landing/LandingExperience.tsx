import { getSession, isLocalDemoEnabled } from "@/lib/session";
import { HeroHeadline } from "./HeroHeadline";
import { RivetNav } from "./RivetNav";
import "./landing.css";

export async function LandingExperience() {
  const session = await getSession();
  const setupHref = session ? "/wizard" : "/api/auth/login";
  const demoHref = !session && isLocalDemoEnabled() ? "/api/auth/dev-login" : null;

  return (
    <div className="rivet-landing">
      <a className="px-skip" href="#main">
        Skip to content
      </a>
      <img
        className="px-art"
        src="/rivet-night-background.png"
        alt=""
        aria-hidden="true"
      />
      <RivetNav setupHref={setupHref} demoHref={demoHref} />
      <main id="main" className="px-main">
        <section className="px-hero" aria-labelledby="landing-title">
          <div className="px-hero-copy">
            <HeroHeadline />
            <p className="px-subcopy">Rivet helps run support for your Slack community.</p>
            <a className="px-primary-cta" href={setupHref}>
              <span className="px-cta-face">
                <span>Set up Rivet</span>
                <span className="px-cta-arrow" aria-hidden="true" />
              </span>
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
