import { AlertCircle, Camera, Mic, Pause, Square, Volume2 } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";

import styles from "./mocks.module.css";

/**
 * Chapter 01 — a real bug being recorded: someone else's checkout with a failed
 * payment, Kaipu's recording bar across it, the "what am I capturing" card,
 * and the camera bubble, with Kai in it.
 *
 * The figures are invented sample data, not real orders.
 */
export function MockRecord() {
  return (
    <div style={{ position: "relative" }}>
      <div className={`${styles.window} kl-window`}>
        <div className={styles.bar}>
          <div className={styles.lights}>
            <span className={`${styles.light} ${styles.red}`} />
            <span className={`${styles.light} ${styles.amber}`} />
            <span className={`${styles.light} ${styles.green}`} />
          </div>
          <span className={styles.address}>shop.acme.dev/checkout</span>
        </div>

        <div className={styles.sheet}>
          <div className={styles.split}>
            <div>
              <div className={styles.h}>Checkout</div>
              <div className={styles.sub}>Step 3 of 3 · Payment</div>

              <div className={styles.field}>
                <div className={styles.fieldLabel}>Card number</div>
                <div className={styles.fieldValue}>4242 4242 4242 4242</div>
              </div>

              <div className={styles.cols}>
                <div className={styles.field}>
                  <div className={styles.fieldLabel}>Expiry</div>
                  <div className={styles.fieldValue}>04 / 29</div>
                </div>
                <div className={styles.field}>
                  <div className={styles.fieldLabel}>CVC</div>
                  <div className={styles.fieldValue}>•••</div>
                </div>
              </div>

              <div className={styles.alert}>
                <AlertCircle size={15} />
                Payment failed. Try again.
              </div>

              <div className={styles.payBtn}>Pay $48.00</div>
            </div>

            <div className={styles.aside}>
              <div className={styles.asideHead}>Order</div>
              <div className={styles.line}>
                <span>Desk lamp</span>
                <span>$42.00</span>
              </div>
              <div className={styles.line}>
                <span>Shipping</span>
                <span>$6.00</span>
              </div>
              <div className={styles.lineTotal}>
                <span>Total</span>
                <span>$48.00</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Kaipu's own chrome, layered over the captured window. */}
      <div className={`${styles.recBar} kl-float-card`}>
        <span className={styles.timer}>00:45</span>
        <span className={styles.levels}>
          {[0.4, 0.9, 0.6, 1, 0.5].map((h, i) => (
            <span
              key={i}
              className={`${styles.levelBar} kl-anim-levels`}
              style={{ transform: `scaleY(${h})`, animationDelay: `${i * 0.12}s` }}
            />
          ))}
        </span>
        <Pause size={16} />
        <span className={styles.stopBtn}>
          <Square size={12} fill="currentColor" />
        </span>
      </div>

      <div className={`${styles.recCard} kl-float-card`}>
        <div className={styles.recHead}>
          <KaipuLogo use="product" size={15} />
          Recording
        </div>
        <div className={styles.recTitle}>“Payment fails on step 3”</div>
        {[
          { icon: Mic, label: "Your voice" },
          { icon: Volume2, label: "System audio" },
          { icon: Camera, label: "Camera" },
        ].map(({ icon: Icon, label }) => (
          <div key={label} className={styles.recRow}>
            <Icon size={14} />
            {label}
            <span className={styles.recLive}>LIVE</span>
          </div>
        ))}
      </div>

      {/* The real product surface is a live webcam bubble. This marketing
          illustration uses Kai as an intentionally nonliteral sample subject. */}
      <div className={styles.bubble}>
        <KaipuLogo
          use="product"
          size={92}
          className={styles.bubbleFox}
          style={{ borderRadius: 999 }}
        />
      </div>
    </div>
  );
}
