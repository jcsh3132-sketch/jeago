const paths: Record<string, string> = {
  index: '/', style: '/style.css', 'style.css': '/style.css', script: '/script.js', 'script.js': '/script.js',
  'sale-products': '/api/sale-products', 'rent-products': '/api/rent-products', 'cost-discounts': '/api/cost-discounts',
};
export const calculatorHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
export function calculatorPath(asset: string) { return Object.hasOwn(paths, asset) ? paths[asset] : undefined; }
export async function calculatorUpstream(asset: string, options: { body?: string } = {}) {
  const path = calculatorPath(asset); if (!path) throw new Error('Unsupported calculator asset');
  const base = new URL(process.env.CALCULATOR_BASE_URL || '');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Invalid calculator server configuration');
  const key = process.env.CALCULATOR_API_KEY;
  if (!key || /[\r\n]/.test(key)) throw new Error('Missing calculator credentials');
  return fetch(new URL(path, base), {
    method: options.body === undefined ? 'GET' : 'POST',
    headers: { 'X-Calculator-Key': key, ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(options.body === undefined ? {} : { body: options.body }),
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
}
export function calculatorHtml(html: string, userId: string, integration: string) {
  // Pricing and calculation JS remain upstream; credentials never enter HTML.
  const account = JSON.stringify(encodeURIComponent(userId));
  const bootstrap = `<script>
window.CALCULATOR_API={saleProducts:'/calculator/content/sale-products',rentProducts:'/calculator/content/rent-products',costDiscounts:'/calculator/content/cost-discounts'};
(function(){var prefix='jeago:calculator:'+${account}+':',storage;try{storage=window.localStorage;}catch(e){}var memory={};
var scoped={getItem:function(k){try{return storage?storage.getItem(prefix+k):(memory[k]||null);}catch(e){return null;}},setItem:function(k,v){try{if(storage)storage.setItem(prefix+k,String(v));else memory[k]=String(v);}catch(e){}},removeItem:function(k){try{if(storage)storage.removeItem(prefix+k);delete memory[k];}catch(e){}}};
try{Object.defineProperty(window,'localStorage',{value:scoped});}catch(e){}
scoped.setItem('themeMode','light');})();
</script><link rel="stylesheet" href="/calculator/content/integration-style">`;
  let result = html.replace(/\b(href|src)=(['"])(?:\.\/|\/)?(style\.css|script\.js)(\?[^'"]*)?\2/gi,
    (_match, attribute, quote, asset, query = '') => `${attribute}=${quote}/calculator/content/${asset}${query}${quote}`);
  if (!/<\/head\s*>/i.test(result) || !/<\/body\s*>/i.test(result)) throw new Error('Invalid upstream calculator HTML');
  result = result.replace(/<\/head\s*>/i, `${bootstrap}</head>`);
  return result.replace(/<\/body\s*>/i, `${integration}<script src="/calculator/content/api-settings"></script></body>`);
}
