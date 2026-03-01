/* ============================================
   NexaEdge Digital — Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
    initNavbar();
    initScrollReveal();
    initCounterAnimation();
    initSmoothScroll();
    initContactForm();
    initParticles();
    initVideoPlaceholders();
    initTiltEffect();
});

/* --- Navbar --- */
function initNavbar() {
    const navbar = document.getElementById('navbar');
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.getElementById('navLinks');

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    navToggle.addEventListener('click', () => {
        navToggle.classList.toggle('active');
        navLinks.classList.toggle('active');
    });

    navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navToggle.classList.remove('active');
            navLinks.classList.remove('active');
        });
    });

    // Active link tracking
    const sections = document.querySelectorAll('section[id]');
    const navLinksAll = navLinks.querySelectorAll('a[href^="#"]');
    window.addEventListener('scroll', () => {
        let current = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop - 100;
            if (window.scrollY >= sectionTop) {
                current = section.getAttribute('id');
            }
        });
        navLinksAll.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${current}`) {
                link.classList.add('active');
            }
        });
    });
}

/* --- Scroll Reveal --- */
function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });
    reveals.forEach(el => observer.observe(el));
}

/* --- Counter Animation --- */
function initCounterAnimation() {
    const counters = document.querySelectorAll('[data-target]');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const target = parseInt(el.getAttribute('data-target'));
                const suffix = el.getAttribute('data-suffix') || '';
                animateCounter(el, target, suffix);
                observer.unobserve(el);
            }
        });
    }, { threshold: 0.5 });
    counters.forEach(counter => observer.observe(counter));
}

function animateCounter(el, target, suffix) {
    const duration = 2000;
    const start = performance.now();
    function update(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(eased * target);
        el.textContent = formatNumber(current) + suffix;
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

function formatNumber(num) {
    return num >= 1000 ? num.toLocaleString() : num.toString();
}

/* --- Smooth Scroll --- */
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            const target = document.querySelector(targetId);
            if (target) {
                const offset = 80;
                const targetPos = target.getBoundingClientRect().top + window.scrollY - offset;
                window.scrollTo({ top: targetPos, behavior: 'smooth' });
            }
        });
    });
}

/* --- Contact Form --- */
function initContactForm() {
    const form = document.getElementById('contactFormEl');
    if (!form) return;
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = form.querySelector('.form-submit');
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Sending...';

        const formData = new FormData(form);

        fetch(form.action, {
            method: 'POST',
            body: formData,
            headers: {
                'Accept': 'application/json'
            }
        }).then(response => {
            if (response.ok) {
                btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;">✓ Consultation Booked!</span>';
                btn.style.background = 'linear-gradient(135deg, #10b981, #06b6d4)';
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.background = '';
                    form.reset();
                }, 3000);
            } else {
                btn.innerHTML = 'Error Sending';
                btn.style.background = '#ef4444';
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.background = '';
                }, 3000);
            }
        }).catch(error => {
            btn.innerHTML = 'Error Sending';
            btn.style.background = '#ef4444';
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.background = '';
            }, 3000);
        });
    });
}

/* --- Particle Background --- */
function initParticles() {
    const hero = document.querySelector('.hero-bg');
    if (!hero) return;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;';
    hero.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let particles = [];
    let animId;

    function resize() {
        canvas.width = hero.offsetWidth;
        canvas.height = hero.offsetHeight;
    }

    function createParticles() {
        particles = [];
        const count = Math.min(50, Math.floor(canvas.width * canvas.height / 18000));
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
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach((p, i) => {
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0) p.x = canvas.width;
            if (p.x > canvas.width) p.x = 0;
            if (p.y < 0) p.y = canvas.height;
            if (p.y > canvas.height) p.y = 0;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(79, 110, 247, ${p.opacity})`;
            ctx.fill();
            for (let j = i + 1; j < particles.length; j++) {
                const p2 = particles[j];
                const dx = p.x - p2.x, dy = p.y - p2.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 100) {
                    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p2.x, p2.y);
                    ctx.strokeStyle = `rgba(79, 110, 247, ${0.05 * (1 - dist / 100)})`;
                    ctx.lineWidth = 0.5; ctx.stroke();
                }
            }
        });
        animId = requestAnimationFrame(draw);
    }

    resize(); createParticles(); draw();
    window.addEventListener('resize', () => { resize(); createParticles(); });

    const heroObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) { if (!animId) draw(); }
        else { cancelAnimationFrame(animId); animId = null; }
    });
    heroObserver.observe(document.querySelector('.hero'));
}

/* --- Review bar animation on scroll --- */
(function () {
    const bars = document.querySelectorAll('.bar-fill');
    if (!bars.length) return;
    bars.forEach(bar => { bar.dataset.width = bar.style.width; bar.style.width = '0%'; });
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.querySelectorAll('.bar-fill').forEach((bar, i) => {
                    setTimeout(() => { bar.style.width = bar.dataset.width; }, i * 150);
                });
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.3 });
    const card = document.querySelector('.hero-visual-card');
    if (card) observer.observe(card);
})();

/* --- Video Placeholders --- */
function initVideoPlaceholders() {
    document.querySelectorAll('.video-placeholder').forEach(placeholder => {
        placeholder.addEventListener('click', () => {
            const wrapper = placeholder.closest('.video-wrapper');
            const videoType = placeholder.getAttribute('data-video');
            const titles = {
                reputation: 'Genuine Review Generation',
                automation: 'AI-Powered Automation',
                salesforce: 'Salesforce CRM Solutions'
            };
            const overlay = document.createElement('div');
            overlay.style.cssText = `position:absolute;inset:0;z-index:10;
        background:linear-gradient(135deg,rgba(5,8,22,0.95),rgba(15,23,60,0.95));
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:16px;padding:24px;text-align:center;animation:fadeInUp .4s ease;`;
            overlay.innerHTML = `
        <div style="font-size:2.5rem;margin-bottom:8px">🎬</div>
        <h4 style="font-family:'Outfit',sans-serif;font-size:1.2rem;font-weight:700;color:#fff">${titles[videoType] || 'Product Video'}</h4>
        <p style="font-size:.85rem;color:#94a3b8;max-width:280px;line-height:1.6">Full explainer video coming soon.<br>Book a free consultation!</p>
        <a href="https://wa.me/918890819966" class="btn btn-primary" style="padding:10px 24px;font-size:.85rem;margin-top:8px" target="_blank" rel="noopener">WhatsApp Us</a>
        <button style="position:absolute;top:12px;right:12px;background:rgba(255,255,255,0.1);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center" onclick="this.parentElement.remove()">✕</button>`;
            wrapper.style.position = 'relative';
            wrapper.appendChild(overlay);
        });
    });
}

/* --- Tilt Effect on Service Cards --- */
function initTiltEffect() {
    document.querySelectorAll('.service-card').forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left, y = e.clientY - rect.top;
            const rotateX = ((y - rect.height / 2) / (rect.height / 2)) * -3;
            const rotateY = ((x - rect.width / 2) / (rect.width / 2)) * 3;
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
        });
        card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
}
