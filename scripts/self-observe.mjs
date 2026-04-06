/**
 * AEQI Self-Observation Tool
 * 
 * Uses Playwright to screenshot and inspect AEQI's own web UI.
 * Outputs structured findings for the agent to analyze and improve.
 * 
 * Usage:
 *   node scripts/self-observe.mjs [url] [--screenshot] [--dom] [--a11y] [--perf]
 * 
 * Examples:
 *   node scripts/self-observe.mjs http://localhost:4173
 *   node scripts/self-observe.mjs http://localhost:4173 --screenshot --a11y
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const OUT_DIR = join(import.meta.dirname, '..', '.observations');

// ─── Parse args ───
const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith('--')) || 'http://localhost:4173';
const flags = new Set(args.filter(a => a.startsWith('--')));
const doAll = flags.size === 0 || flags.has('--all');
const doScreenshot = doAll || flags.has('--screenshot');
const doDom = doAll || flags.has('--dom');
const doA11y = doAll || flags.has('--a11y');
const doPerf = doAll || flags.has('--perf');

mkdirSync(OUT_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

async function run() {
  console.log(`🔍 Observing: ${url}`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  
  const findings = { url, timestamp, observations: [] };

  try {
    // Navigate
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    findings.statusCode = response?.status();
    findings.title = await page.title();
    
    // Wait for animations
    await page.waitForTimeout(1500);

    // ─── Screenshot ───
    if (doScreenshot) {
      console.log('📸 Taking screenshots...');
      
      // Full page
      const fullPath = join(OUT_DIR, `full-${timestamp}.png`);
      await page.screenshot({ path: fullPath, fullPage: true });
      findings.observations.push({ type: 'screenshot', path: fullPath, variant: 'full' });
      console.log(`  → ${fullPath}`);

      // Viewport only
      const vpPath = join(OUT_DIR, `viewport-${timestamp}.png`);
      await page.screenshot({ path: vpPath, fullPage: false });
      findings.observations.push({ type: 'screenshot', path: vpPath, variant: 'viewport' });
      console.log(`  → ${vpPath}`);

      // Mobile viewport
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      const mobilePath = join(OUT_DIR, `mobile-${timestamp}.png`);
      await page.screenshot({ path: mobilePath, fullPage: true });
      findings.observations.push({ type: 'screenshot', path: mobilePath, variant: 'mobile' });
      console.log(`  → ${mobilePath}`);
      
      // Reset viewport
      await page.setViewportSize({ width: 1440, height: 900 });
    }

    // ─── DOM Analysis ───
    if (doDom) {
      console.log('🌳 Analyzing DOM...');
      
      const domInfo = await page.evaluate(() => {
        const getTree = (el, depth = 0, maxDepth = 3) => {
          if (depth > maxDepth || !el) return null;
          const node = {
            tag: el.tagName?.toLowerCase(),
            id: el.id || undefined,
            classes: el.className && typeof el.className === 'string' 
              ? el.className.split(' ').filter(c => c).slice(0, 5) 
              : undefined,
            text: el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
              ? el.textContent?.trim().slice(0, 60)
              : undefined,
            children: [],
          };
          for (const child of el.children || []) {
            const childNode = getTree(child, depth + 1, maxDepth);
            if (childNode) node.children.push(childNode);
          }
          // Trim empty children arrays
          if (node.children.length === 0) delete node.children;
          return node;
        };

        // Collect key metrics
        const allElements = document.querySelectorAll('*');
        const images = document.querySelectorAll('img');
        const links = document.querySelectorAll('a');
        const buttons = document.querySelectorAll('button');
        const forms = document.querySelectorAll('form');
        const inputs = document.querySelectorAll('input, textarea, select');
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        
        // Check for common issues
        const issues = [];
        
        // Images without alt
        images.forEach(img => {
          if (!img.alt) issues.push({ type: 'a11y', severity: 'warning', msg: `Image missing alt: ${img.src?.slice(0, 80)}` });
        });
        
        // Empty links
        links.forEach(a => {
          if (!a.textContent?.trim() && !a.getAttribute('aria-label')) {
            issues.push({ type: 'a11y', severity: 'warning', msg: `Empty link: ${a.href?.slice(0, 60)}` });
          }
        });
        
        // Buttons without accessible text
        buttons.forEach(btn => {
          if (!btn.textContent?.trim() && !btn.getAttribute('aria-label')) {
            issues.push({ type: 'a11y', severity: 'warning', msg: 'Button without accessible text' });
          }
        });

        // Heading hierarchy
        const headingLevels = [...headings].map(h => parseInt(h.tagName[1]));
        for (let i = 1; i < headingLevels.length; i++) {
          if (headingLevels[i] - headingLevels[i-1] > 1) {
            issues.push({ type: 'structure', severity: 'info', msg: `Heading skip: h${headingLevels[i-1]} → h${headingLevels[i]}` });
          }
        }

        return {
          stats: {
            totalElements: allElements.length,
            images: images.length,
            links: links.length,
            buttons: buttons.length,
            forms: forms.length,
            inputs: inputs.length,
            headings: headings.length,
          },
          headingStructure: [...headings].map(h => ({
            level: parseInt(h.tagName[1]),
            text: h.textContent?.trim().slice(0, 80),
          })),
          issues,
          tree: getTree(document.body),
        };
      });

      findings.dom = domInfo;
      console.log(`  → ${domInfo.stats.totalElements} elements, ${domInfo.issues.length} issues found`);
    }

    // ─── Accessibility Audit ───
    if (doA11y) {
      console.log('♿ Running accessibility checks...');
      
      const a11y = await page.evaluate(() => {
        const results = [];
        
        // Color contrast (basic check)
        const checkContrast = (el) => {
          const style = getComputedStyle(el);
          const color = style.color;
          const bg = style.backgroundColor;
          if (color && bg && bg !== 'rgba(0, 0, 0, 0)') {
            results.push({ element: el.tagName, color, bg, text: el.textContent?.trim().slice(0, 40) });
          }
        };
        
        document.querySelectorAll('p, span, a, button, h1, h2, h3').forEach(checkContrast);
        
        // Focus indicators
        const focusable = document.querySelectorAll('a, button, input, select, textarea, [tabindex]');
        let missingFocus = 0;
        focusable.forEach(el => {
          const style = getComputedStyle(el);
          if (style.outlineStyle === 'none' && !style.boxShadow.includes('rgb')) {
            missingFocus++;
          }
        });
        
        // Landmark regions
        const landmarks = {
          main: document.querySelectorAll('main, [role="main"]').length,
          nav: document.querySelectorAll('nav, [role="navigation"]').length,
          banner: document.querySelectorAll('header, [role="banner"]').length,
          contentinfo: document.querySelectorAll('footer, [role="contentinfo"]').length,
        };
        
        // Skip link
        const skipLink = document.querySelector('a[href="#main"], a[href="#content"]');
        
        return {
          contrastSamples: results.slice(0, 10),
          focusableCount: focusable.length,
          missingFocusIndicator: missingFocus,
          landmarks,
          hasSkipLink: !!skipLink,
          lang: document.documentElement.lang || 'MISSING',
        };
      });

      findings.a11y = a11y;
      console.log(`  → Lang: ${a11y.lang}, Focusable: ${a11y.focusableCount}, Missing focus: ${a11y.missingFocusIndicator}`);
    }

    // ─── Performance ───
    if (doPerf) {
      console.log('⚡ Measuring performance...');
      
      const perf = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const paint = performance.getEntriesByType('paint');
        const resources = performance.getEntriesByType('resource');
        
        const byType = {};
        resources.forEach(r => {
          const ext = r.name.split('?')[0].split('.').pop() || 'other';
          if (!byType[ext]) byType[ext] = { count: 0, totalSize: 0, totalDuration: 0 };
          byType[ext].count++;
          byType[ext].totalSize += r.transferSize || 0;
          byType[ext].totalDuration += r.duration || 0;
        });

        return {
          navigation: {
            domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0),
            loadComplete: Math.round(nav?.loadEventEnd || 0),
            ttfb: Math.round(nav?.responseStart || 0),
          },
          paint: paint.map(p => ({ name: p.name, time: Math.round(p.startTime) })),
          resources: {
            total: resources.length,
            totalTransfer: resources.reduce((s, r) => s + (r.transferSize || 0), 0),
            byType,
          },
          memory: performance.memory ? {
            usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
            totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
          } : null,
        };
      });

      findings.perf = perf;
      console.log(`  → TTFB: ${perf.navigation.ttfb}ms, DOM Ready: ${perf.navigation.domContentLoaded}ms, ${perf.resources.total} resources`);
    }

    // ─── Console errors ───
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    if (consoleErrors.length > 0) {
      findings.consoleErrors = consoleErrors;
      console.log(`⚠️  ${consoleErrors.length} console errors detected`);
    }

  } catch (err) {
    findings.error = err.message;
    console.error(`❌ Error: ${err.message}`);
  } finally {
    await browser.close();
  }

  // Write findings JSON
  const findingsPath = join(OUT_DIR, `findings-${timestamp}.json`);
  writeFileSync(findingsPath, JSON.stringify(findings, null, 2));
  console.log(`\n📋 Findings saved: ${findingsPath}`);
  
  // Print summary
  console.log('\n' + '═'.repeat(50));
  console.log('SUMMARY');
  console.log('═'.repeat(50));
  console.log(`URL: ${findings.url}`);
  console.log(`Status: ${findings.statusCode}`);
  console.log(`Title: ${findings.title}`);
  console.log(`Observations: ${findings.observations.length} screenshots`);
  if (findings.dom) {
    console.log(`DOM: ${findings.dom.stats.totalElements} elements, ${findings.dom.issues.length} issues`);
  }
  if (findings.a11y) {
    console.log(`A11y: ${findings.a11y.focusableCount} focusable, ${findings.a11y.missingFocusIndicator} missing focus`);
  }
  if (findings.perf) {
    console.log(`Perf: TTFB ${findings.perf.navigation.ttfb}ms, DOM ${findings.perf.navigation.domContentLoaded}ms`);
  }
  console.log('═'.repeat(50));

  return findings;
}

run().catch(console.error);
