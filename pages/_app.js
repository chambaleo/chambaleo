import { useEffect } from "react";
import Head from "next/head";
import "../styles/global.css";
import "../styles/vacancy-submission.css";

export default function App({ Component, pageProps }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.error("Chambaleo service worker registration failed:", error);
    });
  }, []);

  return (
    <>
      <Head>
        <meta name="application-name" content="Chambaleo" />
        <meta name="theme-color" content="#6754E8" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Chambaleo" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
