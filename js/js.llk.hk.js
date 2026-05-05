/*!
 * llk.js — 流量刊 (llk.hk) 采集 SDK
 * 目标体积 < 5kb (gzip)
 * 用法: <script src="//js.llk.hk" data-site-id="YOUR_SITE_ID" async></script>
 */
(function (window) {
  'use strict';

  // ── 常量 ────────────────────────────────────────────────────
  var COLLECT_URL = 'https://api.llk.hk/v1/collect';
  var STORAGE_KEY = 'llk_disabled';
  var DELAY_MS    = 300;
  var _data       = 'data-';

  // ── 读取脚本属性 ─────────────────────────────────────────────
  var script  = document.currentScript;
  if (!script) return;

  var siteId      = script.getAttribute(_data + 'site-id');
  var hostUrl     = script.getAttribute(_data + 'host-url');
  var autoTrack   = script.getAttribute(_data + 'auto-track')  !== 'false';
  var respectDnt  = script.getAttribute(_data + 'respect-dnt') === 'true';
  var domains     = (script.getAttribute(_data + 'domains') || '').split(',').map(function(d){ return d.trim(); }).filter(Boolean);
  var securityMonitor = script.getAttribute(_data + 'security-monitor') !== 'false'; // 默认开启，可通过 data-security-monitor="false" 禁用
  var securitySampleRate = parseFloat(script.getAttribute(_data + 'security-sample-rate') || '0.1'); // 采样率，默认10%（降低数据量）
  var trustedDomains = (script.getAttribute(_data + 'trusted-domains') || '').split(',').map(function(d){ return d.trim(); }).filter(Boolean); // 用户自定义白名单

  if (!siteId) { console.warn('[llk] 缺少 data-site-id'); return; }

  // 支持自定义采集地址，默认使用 api.llk.hk
  var endpoint = hostUrl || COLLECT_URL;
  // 如果 hostUrl 不包含完整路径，自动补全
  if (hostUrl && hostUrl.indexOf('/collect') === -1) {
    endpoint = endpoint.replace(/\/$/, '') + '/v1/collect';
  }

  // ── 工具函数 ─────────────────────────────────────────────────
  var loc = window.location;
  var nav = window.navigator;
  var screen = window.screen;

  function getStorage() {
    try { return loc.href.startsWith('data:') ? null : window.localStorage; }
    catch(e) { return null; }
  }

  function hasDnt() {
    var dnt = window.doNotTrack || nav.doNotTrack || nav.msDoNotTrack;
    return dnt === '1' || dnt === 1 || dnt === 'yes';
  }

  function isDisabled() {
    if (!siteId) return true;
    if (domains.length && domains.indexOf(loc.hostname) === -1) return true;
    if (respectDnt && hasDnt()) return true;
    var ls = getStorage();
    if (ls && ls.getItem(STORAGE_KEY)) return true;
    return false;
  }

  function getScreenSize() {
    return screen.width + 'x' + screen.height;
  }

  // 生成或复用匿名会话标识 (存于 sessionStorage，不跨会话)
  function getSessionId() {
    try {
      var ss = window.sessionStorage;
      var key = 'llk_sid';
      var sid = ss.getItem(key);
      if (!sid) {
        var arr = new Uint8Array(12);
        (window.crypto || window.msCrypto).getRandomValues(arr);
        sid = Array.from(arr).map(function(b){ return b.toString(16).padStart(2,'0'); }).join('') + Date.now().toString(36);
        ss.setItem(key, sid);
      }
      return sid;
    } catch(e) { return ''; }
  }

  // ── Payload 构造 ─────────────────────────────────────────────
  var currentUrl = loc.href;
  var currentRef = document.referrer || '';

  // 过滤掉来自本站的 referrer
  function getCleanReferrer() {
    if (!currentRef) return '';
    try {
      var refHost = new URL(currentRef).hostname;
      var curHost = loc.hostname;
      // 如果 referrer 和当前页面是同一个域名，返回空字符串
      if (refHost === curHost) return '';
      return currentRef;
    } catch(e) {
      return currentRef;
    }
  }

  // 性能指标收集
  var perfMetrics = {};

  function collectWebVitals() {
    // 收集 Core Web Vitals
    if (!window.PerformanceObserver) return;

    // LCP (Largest Contentful Paint)
    try {
      new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        var lastEntry = entries[entries.length - 1];
        perfMetrics.lcp = Math.round(lastEntry.renderTime || lastEntry.loadTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch(e) {}

    // FID (First Input Delay)
    try {
      new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        entries.forEach(function(entry) {
          if (entry.processingStart && entry.startTime) {
            perfMetrics.fid = Math.round(entry.processingStart - entry.startTime);
          }
        });
      }).observe({ type: 'first-input', buffered: true });
    } catch(e) {}

    // CLS (Cumulative Layout Shift)
    try {
      var clsValue = 0;
      new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        entries.forEach(function(entry) {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
            perfMetrics.cls = Math.round(clsValue * 1000) / 1000;
          }
        });
      }).observe({ type: 'layout-shift', buffered: true });
    } catch(e) {}

    // FCP (First Contentful Paint)
    try {
      new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        entries.forEach(function(entry) {
          if (entry.name === 'first-contentful-paint') {
            perfMetrics.fcp = Math.round(entry.startTime);
          }
        });
      }).observe({ type: 'paint', buffered: true });
    } catch(e) {}

    // TTFB (Time to First Byte)
    try {
      var navTiming = performance.getEntriesByType('navigation')[0];
      if (navTiming) {
        perfMetrics.ttfb = Math.round(navTiming.responseStart - navTiming.requestStart);
      }
    } catch(e) {}
  }

  function buildPayload(eventName, eventData) {
    var payload = {
      site_id:  siteId,
      url:      currentUrl,
      ref:      getCleanReferrer(),
      screen:   getScreenSize(),
      lang:     nav.language || nav.userLanguage || '',
      event:    eventName || 'pageview',
      title:    document.title || '',
      sid:      getSessionId(),
      data:     eventData || undefined,
    };

    // 首次 pageview 时附加性能指标
    if (eventName === 'pageview' && Object.keys(perfMetrics).length > 0) {
      payload.perf = perfMetrics;
    }

    return payload;
  }

  // ── 发送函数（优先 sendBeacon，降级 fetch）──────────────────
  function send(payload) {
    if (isDisabled()) return;
    var body = JSON.stringify(payload);
    // sendBeacon：使用 text/plain 避免触发 CORS 预检和系统权限弹窗
    // 后端 collect 端点接受 text/plain body（JSON 内容不变）
    if (nav.sendBeacon) {
      try {
        var blob = new Blob([body], { type: 'text/plain' });
        if (nav.sendBeacon(endpoint, blob)) return;
      } catch(e) { /* 降级 */ }
    }
    // 降级：keepalive fetch，同样用 text/plain 避免预检
    try {
      fetch(endpoint, {
        method: 'POST',
        body: body,
        headers: { 'Content-Type': 'text/plain' },
        keepalive: true,
        credentials: 'omit',
      });
    } catch(e) { /* 静默失败，不影响宿主页面 */ }
  }

  function track(eventName, eventData) {
    send(buildPayload(eventName, eventData));
  }

  // ── SPA 路由监听 ─────────────────────────────────────────────
  function hookHistory(method) {
    var orig = window.history[method];
    window.history[method] = function() {
      orig.apply(this, arguments);
      var newUrl = window.location.href;
      if (newUrl !== currentUrl) {
        currentRef = currentUrl;
        currentUrl = newUrl;
        setTimeout(function(){ track('pageview'); }, DELAY_MS);
      }
    };
  }
  hookHistory('pushState');
  hookHistory('replaceState');
  window.addEventListener('popstate', function() {
    var newUrl = window.location.href;
    if (newUrl !== currentUrl) {
      currentRef = currentUrl;
      currentUrl = newUrl;
      setTimeout(function(){ track('pageview'); }, DELAY_MS);
    }
  });

  // ── 自定义事件：data-llk-event 属性 ────────────────────────
  function handleClicks() {
    document.addEventListener('click', function(e) {
      var el = e.target;
      // 向上查找最近带有 data-llk-event 的元素
      var target = el;
      while (target && target !== document) {
        var evtName = target.getAttribute('data-llk-event');
        if (evtName) {
          var evtData = {};
          var attrs = target.attributes;
          for (var i = 0; i < attrs.length; i++) {
            var match = attrs[i].name.match(/^data-llk-event-(.+)$/);
            if (match) evtData[match[1]] = attrs[i].value;
          }
          track(evtName, Object.keys(evtData).length ? evtData : undefined);
          break;
        }
        target = target.parentElement;
      }
    }, true);
  }

  // ── 安全监控 ─────────────────────────────────────────────────

  // 采样检查：根据配置的采样率决定是否上报
  function shouldReportSecurity() {
    return Math.random() < securitySampleRate;
  }

  // 严重程度映射
  var SEVERITY_MAP = {
    'csp': 'medium',
    'js_error': 'low',
    'script_injection': 'high',
    'iframe_injection': 'medium',
    'form_hijacking': 'high',
    'abnormal_activity': 'medium',
    'form_action_modified': 'critical'
  };

  // 安全事件上报（带严重程度）
  function trackSecurity(alertType, data) {
    if (!shouldReportSecurity()) return;

    var severity = SEVERITY_MAP[alertType] || 'low';
    track('security_alert', Object.assign({}, data, {
      alert_type: alertType,
      severity: severity
    }));
  }

  // URL 脱敏：移除敏感查询参数
  function sanitizeUrl(url) {
    if (!url) return '';
    try {
      var urlObj = new URL(url);
      // 移除常见的敏感参数
      var sensitiveParams = ['token', 'access_token', 'api_key', 'apikey', 'key', 'secret', 'password', 'pwd', 'auth', 'session', 'sid'];
      sensitiveParams.forEach(function(param) {
        if (urlObj.searchParams.has(param)) {
          urlObj.searchParams.set(param, '[REDACTED]');
        }
      });
      return urlObj.toString();
    } catch(e) {
      // 如果解析失败，返回原始URL（可能是相对路径）
      return url;
    }
  }

  // CSP 违规检测
  var cspReported = {};
  function monitorCSP() {
    document.addEventListener('securitypolicyviolation', function(e) {
      // 生成违规指纹，避免重复报告
      var violationKey = e.violatedDirective + ':' + e.blockedURI;
      if (cspReported[violationKey]) return;
      cspReported[violationKey] = true;

      track('security_violation', {
        type: 'csp',
        violated_directive: e.violatedDirective,
        blocked_uri: sanitizeUrl(e.blockedURI),
        source_file: sanitizeUrl(e.sourceFile),
        line_number: e.lineNumber,
        severity: 'medium'
        // 不发送 original_policy，避免泄露完整CSP配置
      });
    });
  }

  // JavaScript 错误监控
  var errorReported = {};
  var ERROR_REPORT_LIMIT = 3; // 每个错误类型最多报告3次（降低噪音）

  function monitorErrors() {
    // 全局错误捕获
    window.addEventListener('error', function(e) {
      // 过滤掉资源加载错误（如图片、CSS）
      if (e.target && e.target !== window) return;

      // 过滤掉浏览器扩展的错误
      var filename = e.filename || '';
      if (filename.startsWith('chrome-extension://') ||
          filename.startsWith('moz-extension://') ||
          filename.startsWith('safari-extension://') ||
          filename.startsWith('webkit-masked-url://')) {
        return;
      }

      // 过滤掉第三方脚本的错误（非本站域名）
      if (filename && !filename.includes(loc.hostname) && !filename.includes('llk.hk')) {
        return;
      }

      // 过滤掉常见的无意义错误
      var message = e.message || '';
      var ignoredMessages = [
        'ResizeObserver loop',
        'Script error',
        'Non-Error promise rejection',
        'Loading chunk',
        'Failed to fetch'
      ];
      if (ignoredMessages.some(function(ignored) { return message.includes(ignored); })) {
        return;
      }

      // 生成错误指纹，避免重复报告相同错误
      var errorKey = (e.message || '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0);
      errorReported[errorKey] = (errorReported[errorKey] || 0) + 1;

      // 限制每个错误的报告次数
      if (errorReported[errorKey] > ERROR_REPORT_LIMIT) return;

      track('js_error', {
        message: e.message ? e.message.substring(0, 200) : '',
        source: sanitizeUrl(filename),
        line: e.lineno,
        column: e.colno,
        stack: e.error && e.error.stack ? e.error.stack.substring(0, 300) : '',
        count: errorReported[errorKey],
        severity: 'low'
      });
    });

    // Promise 未捕获错误
    window.addEventListener('unhandledrejection', function(e) {
      var message = e.reason && e.reason.message ? e.reason.message : String(e.reason);

      // 过滤掉常见的无意义错误
      var ignoredMessages = [
        'Non-Error promise rejection',
        'Loading chunk',
        'Failed to fetch',
        'NetworkError'
      ];
      if (ignoredMessages.some(function(ignored) { return message.includes(ignored); })) {
        return;
      }

      var errorKey = 'promise:' + message.substring(0, 100);

      errorReported[errorKey] = (errorReported[errorKey] || 0) + 1;
      if (errorReported[errorKey] > ERROR_REPORT_LIMIT) return;

      track('js_error', {
        type: 'unhandled_promise',
        message: message.substring(0, 200),
        stack: e.reason && e.reason.stack ? e.reason.stack.substring(0, 300) : '',
        count: errorReported[errorKey],
        severity: 'low'
      });
    });
  }

  // 页面篡改检测
  function monitorDOMTampering() {
    // 白名单：常见的合法第三方域名（内置 + 用户自定义）
    var builtInTrustedDomains = [
      'google.com', 'googleapis.com', 'gstatic.com', 'googletagmanager.com', 'google-analytics.com', 'doubleclick.net',
      'youtube.com', 'youtu.be', 'ytimg.com',
      'facebook.com', 'fbcdn.net', 'facebook.net',
      'twitter.com', 'twimg.com', 'x.com',
      'cloudflare.com', 'jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com',
      'vimeo.com', 'dailymotion.com',
      'stripe.com', 'paypal.com',
      'llk.hk', 'zevo.wiki', // 自己的域名
      'localhost', '127.0.0.1' // 本地开发
    ];
    var allTrustedDomains = builtInTrustedDomains.concat(trustedDomains);

    function isTrustedDomain(url) {
      if (!url) return false;
      try {
        var hostname = new URL(url).hostname;
        // 本地开发环境
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
          return true;
        }
        return allTrustedDomains.some(function(domain) {
          return hostname === domain || hostname.endsWith('.' + domain);
        });
      } catch(e) {
        return false;
      }
    }

    // 记录初始的iframe和脚本，避免误报
    var initialScripts = [];
    var reportedIframes = {};
    var reportedScripts = {};

    // 延迟记录初始脚本，等待页面加载完成
    setTimeout(function() {
      initialScripts = Array.from(document.querySelectorAll('script[src]')).map(function(s) { return s.src; });
    }, 2000);

    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          // 检测可疑的iframe注入
          if (node.nodeName === 'IFRAME') {
            var src = node.src || '';
            // 忽略空 src、data: 协议、blob: 协议
            if (!src || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('about:')) {
              return;
            }
            // 只报告非信任域名的iframe，且避免重复报告
            if (!isTrustedDomain(src) && !reportedIframes[src]) {
              trackSecurity('iframe_injection', {
                src: sanitizeUrl(src),
                parent: node.parentElement ? node.parentElement.tagName : ''
              });
              reportedIframes[src] = true;
            }
          }
          // 检测可疑的脚本注入
          if (node.nodeName === 'SCRIPT' && node.src) {
            var scriptSrc = node.src;
            // 忽略内联脚本、data: 协议、blob: 协议
            if (scriptSrc.startsWith('data:') || scriptSrc.startsWith('blob:')) {
              return;
            }
            // 只报告：1) 外部域名 2) 非信任域名 3) 非初始脚本 4) 未报告过的
            if (!scriptSrc.includes(loc.hostname) &&
                !isTrustedDomain(scriptSrc) &&
                initialScripts.indexOf(scriptSrc) === -1 &&
                !reportedScripts[scriptSrc]) {
              trackSecurity('script_injection', {
                src: sanitizeUrl(scriptSrc)
              });
              reportedScripts[scriptSrc] = true;
            }
          }
        });
      });
    });

    // 延迟启动监听，避免页面初始化时的误报
    setTimeout(function() {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }, 3000);
  }

  // 异常行为检测
  var activityLog = {};
  var ACTIVITY_WINDOW = 10000; // 10秒窗口
  var SUSPICIOUS_THRESHOLD = {
    click: 100,   // 10秒内超过100次点击（提高阈值，避免正常快速点击误报）
    scroll: 200,  // 10秒内超过200次滚动（滚动事件触发频繁，提高阈值）
    keydown: 200  // 10秒内超过200次按键（提高阈值，避免快速打字误报）
  };
  var alerted = {}; // 防止重复报警

  function monitorAbnormalBehavior() {
    var events = ['click', 'scroll', 'keydown'];

    events.forEach(function(eventType) {
      activityLog[eventType] = [];

      document.addEventListener(eventType, function() {
        var now = Date.now();
        activityLog[eventType].push(now);

        // 清理过期记录
        activityLog[eventType] = activityLog[eventType].filter(function(time) {
          return now - time < ACTIVITY_WINDOW;
        });

        // 检测异常高频操作
        var threshold = SUSPICIOUS_THRESHOLD[eventType];
        if (activityLog[eventType].length > threshold && !alerted[eventType]) {
          trackSecurity('abnormal_activity', {
            event_type: eventType,
            count: activityLog[eventType].length,
            window_ms: ACTIVITY_WINDOW
          });
          alerted[eventType] = true;
          // 60秒后重置报警状态
          setTimeout(function() {
            alerted[eventType] = false;
          }, 60000);
        }
      }, { passive: true });
    });
  }

  // 表单劫持检测
  function monitorFormHijacking() {
    // 白名单：常见的合法第三方表单提交域名
    var trustedFormDomains = [
      'paypal.com', 'stripe.com', 'square.com',
      'alipay.com', 'wechat.com',
      'auth0.com', 'okta.com',
      'mailchimp.com', 'sendgrid.com'
    ].concat(trustedDomains);

    function isTrustedFormDomain(hostname) {
      return trustedFormDomains.some(function(domain) {
        return hostname === domain || hostname.endsWith('.' + domain);
      });
    }

    // 记录表单初始 action，检测动态修改
    var formActions = new WeakMap();

    // 记录所有表单的初始 action
    setTimeout(function() {
      var forms = document.querySelectorAll('form');
      forms.forEach(function(form) {
        if (form.action) {
          formActions.set(form, form.action);
        }
      });
    }, 1000);

    document.addEventListener('submit', function(e) {
      var form = e.target;
      var action = form.action;

      // 检测表单提交到外部域名
      try {
        var actionHost = new URL(action).hostname;
        if (actionHost && actionHost !== loc.hostname && !isTrustedFormDomain(actionHost)) {
          // 检查是否是动态修改的 action（可能是 XSS 攻击）
          var originalAction = formActions.get(form);
          var isDynamicallyModified = originalAction && originalAction !== action;

          trackSecurity(isDynamicallyModified ? 'form_action_modified' : 'form_hijacking', {
            action: sanitizeUrl(action),
            original_action: isDynamicallyModified ? sanitizeUrl(originalAction) : undefined,
            method: form.method,
            form_id: form.id || ''
          });
        }
      } catch(e) {}
    }, true);
  }

  // ── 初始化 ───────────────────────────────────────────────────
  function init() {
    // 收集性能指标
    collectWebVitals();

    // 启用安全监控（可通过 data-security-monitor="false" 禁用）
    if (securityMonitor) {
      try {
        monitorCSP();
        monitorErrors();
        if (window.MutationObserver) {
          monitorDOMTampering();
        }
        monitorAbnormalBehavior();
        monitorFormHijacking();
      } catch(e) {
        // 安全监控失败不应影响主功能
      }
    }

    if (autoTrack) {
      // 延迟发送 pageview，等待性能指标收集
      setTimeout(function() {
        track('pageview');
      }, 100);
      handleClicks();
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  // ── 暴露公共 API ─────────────────────────────────────────────
  window.llk = {
    track: track,
    /**
     * 禁用采集（用户选择退出）
     * llk.optOut()  — 写入 localStorage 标记
     * llk.optIn()   — 清除标记
     */
    optOut: function() {
      var ls = getStorage();
      if (ls) ls.setItem(STORAGE_KEY, '1');
    },
    optIn: function() {
      var ls = getStorage();
      if (ls) ls.removeItem(STORAGE_KEY);
    },
    isDisabled: isDisabled,
  };

})(window);



