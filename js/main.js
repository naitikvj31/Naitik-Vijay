(function () {
  'use strict';

  const M = window.Motion || null;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const supportsHover = window.matchMedia('(hover: hover)').matches;
  let lenis = null;

  document.addEventListener('DOMContentLoaded', function () {
    initSmoothScroll();
    initNavbar();
    initScrollProgress();
    initBackToTop();
    initScrollReveal();
    initCounters();
    initContactForm();
    initReviewBars();
    if (!prefersReducedMotion) {
      initParticles();
      initHeroParallax();
    }
    if (supportsHover && !prefersReducedMotion) {
      initMagneticButtons();
      initTilt();
    }
  });

  function initSmoothScroll() {
    const anchorScroll = function (target) {
      const top = target.getBoundingClientRect().top + window.scrollY - 80;
      if (lenis) {
        lenis.scrollTo(top, { duration: 1.1 });
      } else {
        window.scrollTo({ top: top, behavior: 'smooth' });
      }
    };

    if (window.Lenis && !prefersReducedMotion) {
      lenis = new window.Lenis({
        duration: 1.1,
        easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
        smoothWheel: true
      });
      document.documentElement.classList.add('lenis-enabled');
      requestAnimationFrame(function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
      });
    }

    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        const id = this.getAttribute('href');
        if (id === '#') return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        anchorScroll(target);
      });
    });
  }

  function initNavbar() {
    const navbar = document.getElementById('navbar');
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.getElementById('navLinks');
    if (!navbar || !navToggle || !navLinks) return;

    window.addEventListener('scroll', function () {
      navbar.classList.toggle('scrolled', window.scrollY > 50);
    }, { passive: true });

    const closeMenu = function () {
      navToggle.classList.remove('active');
      navLinks.classList.remove('active');
      navToggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    };
    const openMenu = function () {
      navToggle.classList.add('active');
      navLinks.classList.add('active');
      navToggle.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    };

    navToggle.addEventListener('click', function () {
      navLinks.classList.contains('active') ? closeMenu() : openMenu();
    });
    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navLinks.classList.contains('active')) {
        closeMenu();
        navToggle.focus();
      }
    });
    document.addEventListener('click', function (e) {
      if (navLinks.classList.contains('active') && !navLinks.contains(e.target) && !navToggle.contains(e.target)) {
        closeMenu();
      }
    });

    const sections = document.querySelectorAll('section[id], header[id]');
    const links = navLinks.querySelectorAll('a[href^="#"]');
    window.addEventListener('scroll', function () {
      let current = '';
      sections.forEach(function (section) {
        if (window.scrollY >= section.offsetTop - 120) current = section.id;
      });
      links.forEach(function (link) {
        link.classList.toggle('active', link.getAttribute('href') === '#' + current);
      });
    }, { passive: true });
  }

  function initScrollProgress() {
    const bar = document.getElementById('scrollProgress');
    if (!bar) return;
    if (M && M.scroll) {
      M.scroll(function (progress) { bar.style.width = (progress * 100) + '%'; });
      return;
    }
    window.addEventListener('scroll', function () {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0) + '%';
    }, { passive: true });
  }

  function initBackToTop() {
    const btn = document.getElementById('backToTop');
    if (!btn) return;
    window.addEventListener('scroll', function () {
      btn.classList.toggle('visible', window.scrollY > 600);
    }, { passive: true });
    btn.addEventListener('click', function () {
      if (lenis) lenis.scrollTo(0, { duration: 1.1 });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');
    if (!reveals.length) return;
    document.documentElement.classList.add('reveal-ready');

    groupByParent(reveals).forEach(function (group) {
      group.forEach(function (el, index) {
        if (index > 0 && !el.style.transitionDelay) {
          el.style.transitionDelay = Math.min(index * 90, 540) + 'ms';
        }
      });
    });

    if (!('IntersectionObserver' in window)) {
      reveals.forEach(function (el) { el.classList.add('active'); });
      return;
    }

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('active');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(function (el) { observer.observe(el); });
  }

  function groupByParent(nodeList) {
    const map = new Map();
    Array.prototype.forEach.call(nodeList, function (el) {
      const parent = el.parentElement;
      if (!map.has(parent)) map.set(parent, []);
      map.get(parent).push(el);
    });
    return Array.from(map.values());
  }

  function initCounters() {
    const counters = document.querySelectorAll('[data-target]');
    if (!counters.length || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { observer.observe(el); });
  }

  function animateCounter(el) {
    const target = parseInt(el.getAttribute('data-target'), 10);
    const suffix = el.getAttribute('data-suffix') || '';
    if (prefersReducedMotion) {
      el.textContent = formatNumber(target) + suffix;
      return;
    }
    const duration = 1900;
    const start = performance.now();
    requestAnimationFrame(function update(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = formatNumber(Math.floor(eased * target)) + suffix;
      if (progress < 1) requestAnimationFrame(update);
    });
  }

  function formatNumber(num) {
    return num >= 1000 ? num.toLocaleString() : String(num);
  }

  function initContactForm() {
    const form = document.getElementById('contactFormEl');
    if (!form) return;

    const timestamp = document.getElementById('formTimestamp');
    if (timestamp) timestamp.value = Date.now();
    const status = document.getElementById('formStatus');

    const showStatus = function (message, type) {
      if (!status) return;
      status.textContent = message;
      status.className = 'form-status ' + type;
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const btn = form.querySelector('.form-submit');
      const originalText = btn.textContent;
      btn.textContent = 'Sending...';
      btn.disabled = true;
      showStatus('', '');

      const payload = Object.fromEntries(new FormData(form).entries());

      fetch(form.action, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
      })
        .then(function (response) {
          return response.json().then(function (data) { return { ok: response.ok, data: data }; });
        })
        .then(function (result) {
          if (result.ok) {
            btn.textContent = 'Consultation Booked';
            btn.classList.add('is-success');
            showStatus('Thank you. We will get back to you within 24 hours.', 'success');
            setTimeout(function () {
              btn.textContent = originalText;
              btn.classList.remove('is-success');
              btn.disabled = false;
              form.reset();
              if (timestamp) timestamp.value = Date.now();
            }, 3000);
          } else {
            btn.textContent = originalText;
            btn.disabled = false;
            showStatus(result.data.message || 'Something went wrong. Please try WhatsApp instead.', 'error');
          }
        })
        .catch(function () {
          btn.textContent = originalText;
          btn.disabled = false;
          showStatus('Network error. Please try again or contact us on WhatsApp.', 'error');
        });
    });
  }

  function initReviewBars() {
    const card = document.querySelector('.hero-visual-card');
    if (!card || !('IntersectionObserver' in window)) return;
    const bars = card.querySelectorAll('.bar-fill');
    bars.forEach(function (bar) {
      bar.dataset.width = bar.style.width;
      bar.style.width = '0%';
    });
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          bars.forEach(function (bar, i) {
            setTimeout(function () { bar.style.width = bar.dataset.width; }, i * 160);
          });
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });
    observer.observe(card);
  }

  function initParticles() {
    const hero = document.querySelector('.hero-bg');
    if (!hero) return;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;';
    hero.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let particles = [];
    let animId = null;

    const resize = function () {
      canvas.width = hero.offsetWidth;
      canvas.height = hero.offsetHeight;
    };
    const create = function () {
      particles = [];
      const count = Math.min(56, Math.floor(canvas.width * canvas.height / 17000));
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          size: Math.random() * 2 + 0.5,
          opacity: Math.random() * 0.25 + 0.08
        });
      }
    };
    const draw = function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(129, 140, 248, ' + p.opacity + ')';
        ctx.fill();
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = 'rgba(129, 140, 248, ' + (0.05 * (1 - dist / 110)) + ')';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      animId = requestAnimationFrame(draw);
    };

    resize();
    create();
    draw();
    window.addEventListener('resize', function () { resize(); create(); });

    const heroEl = document.querySelector('.hero');
    if (heroEl) {
      new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) {
          if (!animId) draw();
        } else if (animId) {
          cancelAnimationFrame(animId);
          animId = null;
        }
      }).observe(heroEl);
    }
  }

  function initHeroParallax() {
    const hero = document.querySelector('.hero');
    const orbs = document.querySelectorAll('.hero .gradient-orb');
    if (!hero || !orbs.length) return;
    hero.addEventListener('mousemove', function (e) {
      const rect = hero.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      orbs.forEach(function (orb, i) {
        const depth = (i + 1) * 18;
        orb.style.transform = 'translate3d(' + (x * depth) + 'px,' + (y * depth) + 'px,0)';
      });
    });
    hero.addEventListener('mouseleave', function () {
      orbs.forEach(function (orb) { orb.style.transform = ''; });
    });
  }

  function initMagneticButtons() {
    document.querySelectorAll('.btn-primary, .btn-lg').forEach(function (btn) {
      btn.addEventListener('mousemove', function (e) {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        btn.style.transform = 'translate(' + (x * 0.18) + 'px,' + (y * 0.28) + 'px)';
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.transform = '';
      });
    });
  }

  function initTilt() {
    document.querySelectorAll('.service-card, .portfolio-card, .platform-card, .roadmap-card').forEach(function (card) {
      card.classList.add('tilt');
      card.addEventListener('mousemove', function (e) {
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        const rotateX = (py - 0.5) * -6;
        const rotateY = (px - 0.5) * 6;
        card.style.transform = 'perspective(1000px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg) translateY(-6px)';
        card.style.setProperty('--glare-x', (px * 100) + '%');
        card.style.setProperty('--glare-y', (py * 100) + '%');
      });
      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
      });
    });
  }
})();
