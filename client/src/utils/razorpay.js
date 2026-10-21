const SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loading = null;

/** Loads Razorpay Checkout once, on demand (it's only needed on the billing screen). */
export const loadRazorpay = () => {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay failed to initialise')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not load Razorpay Checkout. Check your connection or ad-blocker.'));
    };
    document.body.appendChild(s);
  });
  return loading;
};
