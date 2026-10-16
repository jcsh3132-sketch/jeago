import {test,expect} from '@playwright/test';
import {loginForTest} from './auth-helper';
test('mobile bottom navigation scrolls to quotation and keeps the selected tab in view',async({page})=>{
 await loginForTest(page.request);await page.setViewportSize({width:390,height:844});await page.goto('/');const nav=page.getByRole('navigation',{name:'모바일 메뉴',exact:true});await expect(nav).toBeVisible();await expect(nav.getByRole('link')).toHaveCount(7);expect(await nav.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);expect(await nav.evaluate(e=>getComputedStyle(e).flexWrap)).toBe('nowrap');
 await nav.evaluate(e=>e.scrollLeft=e.scrollWidth);const quote=nav.getByRole('link',{name:'견적서 작성'});await expect(quote).toBeInViewport();await quote.click();await expect(page).toHaveURL(/\/quotation$/);await expect(quote).toHaveAttribute('aria-current','page');await expect(quote).toBeInViewport();
 for(const width of [320,390,700]){await page.setViewportSize({width,height:844});await page.reload();await expect(quote).toBeInViewport();expect(await nav.evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.screenshot({path:'work/quotation-mobile-navigation.png',fullPage:true});
});
