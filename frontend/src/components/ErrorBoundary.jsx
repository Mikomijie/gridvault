import React from 'react';
import en from '../i18n/en.json';

/**
 * ErrorBoundary (P8, AT-622). React only stops a white screen when a class
 * component implements componentDidCatch/getDerivedStateFromError; nothing
 * else in the tree can. Scoped at the router root so one page's render
 * crash never takes silently — it renders a retry affordance and reloads
 * the app shell (server-side policy re-evaluates on the next request either
 * way, per AT-602).
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('GridVault render error', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        role="alert"
        className="fixed inset-0 z-50 flex items-center justify-center bg-[#131b2e] p-4"
      >
        <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center">
          <h1 className="text-[18px] font-bold text-[#93000a]">{en.errorBoundary.title}</h1>
          <p className="mt-2 text-[13px] text-[#404752]">{en.errorBoundary.body}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 w-full rounded-lg bg-[#005ea4] py-2.5 text-[14px] font-bold text-white"
          >
            {en.errorBoundary.retry}
          </button>
        </div>
      </div>
    );
  }
}
