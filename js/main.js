/* ════════════════════════════════════════════════════════════
   LUMMY DESIGNS — Premium Interactions
   ════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = window.matchMedia('(hover: none)').matches;

  document.body.classList.add('loading');

  /* ─── Preloader ──────────────────────────────────────── */
  window.addEventListener('load', () => {
    const pl = document.getElementById('preloader');
    setTimeout(() => {
      pl.classList.add('done');
      document.body.classList.remove('loading');
      triggerHeroReveal();
    }, reduceMotion ? 100 : 1900);
  });
  // Fallback if load already fired or is slow
  setTimeout(() => {
    const pl = document.getElementById('preloader');
    if (pl && !pl.classList.contains('done')) {
      pl.classList.add('done');
      document.body.classList.remove('loading');
      triggerHeroReveal();
    }
  }, 3200);

  /* ─── Word-split for headings ────────────────────────── */
  document.querySelectorAll('[data-reveal-words]').forEach(el => {
    const text = el.textContent.trim();
    el.innerHTML = '';
    text.split(' ').forEach((word, i, arr) => {
      const wrap = document.createElement('span');
      wrap.style.display = 'inline-block';
      wrap.style.overflow = 'hidden';
      wrap.style.verticalAlign = 'top';
      const inner = document.createElement('span');
      inner.className = 'word';
      inner.textContent = word;
      inner.style.transitionDelay = (i * 0.08) + 's';
      wrap.appendChild(inner);
      el.appendChild(wrap);
      if (i < arr.length - 1) el.appendChild(document.createTextNode(' '));
    });
  });

  function triggerHeroReveal() {
    document.querySelectorAll('.hero [data-reveal], .hero [data-reveal-words]').forEach(el => {
      const delay = parseInt(el.dataset.delay || '0', 10);
      setTimeout(() => el.classList.add('visible'), reduceMotion ? 0 : delay);
    });
  }

  /* ─── Navbar scroll + scroll progress ────────────────── */
  const navbar = document.getElementById('navbar');
  const progress = document.getElementById('scrollProgress');
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav__link');

  function onScroll() {
    const y = window.scrollY;
    navbar.classList.toggle('scrolled', y > 80);

    const h = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (h > 0 ? (y / h) * 100 : 0) + '%';

    let current = '';
    sections.forEach(s => { if (y >= s.offsetTop - 240) current = s.id; });
    navLinks.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + current));
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ─── Hero parallax ──────────────────────────────────── */
  const parallaxEls = document.querySelectorAll('[data-parallax]');
  if (!reduceMotion && !isTouch) {
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      if (y < window.innerHeight) {
        parallaxEls.forEach(el => {
          const speed = parseFloat(el.dataset.parallax);
          el.style.transform = `translateY(${y * speed}px)`;
        });
      }
    }, { passive: true });
  }

  /* ─── Mobile menu ────────────────────────────────────── */
  const hamburger = document.getElementById('hamburger');
  const navMenu = document.getElementById('navLinks');
  hamburger.addEventListener('click', () => {
    const open = hamburger.classList.toggle('open');
    navMenu.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  });
  navMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    hamburger.classList.remove('open');
    navMenu.classList.remove('open');
    document.body.style.overflow = '';
  }));

  /* ─── Reveal on scroll ───────────────────────────────── */
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const delay = parseInt(el.dataset.delay || '0', 10);
      setTimeout(() => el.classList.add('visible'), reduceMotion ? 0 : delay);
      if (el.hasAttribute('data-count')) animateCount(el);
      revealObserver.unobserve(el);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('[data-reveal], [data-reveal-words]').forEach(el => {
    if (!el.closest('.hero')) revealObserver.observe(el);
  });
  // Counters observed independently (in case parent already revealed)
  document.querySelectorAll('[data-count]').forEach(el => {
    if (!el.closest('.hero')) revealObserver.observe(el);
  });

  /* ─── Number counters ────────────────────────────────── */
  function animateCount(el) {
    if (reduceMotion) { el.textContent = el.dataset.count + (el.dataset.suffix || ''); return; }
    const target = parseInt(el.dataset.count, 10);
    const suffix = el.dataset.suffix || '';
    const dur = 1600;
    const start = performance.now();
    function tick(now) {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ─── Smooth scroll ──────────────────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - navbar.offsetHeight - 16;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  /* ─── Custom cursor glow ─────────────────────────────── */
  if (!isTouch && !reduceMotion) {
    const glow = document.getElementById('cursorGlow');
    let gx = 0, gy = 0, cx = 0, cy = 0;
    window.addEventListener('mousemove', (e) => {
      gx = e.clientX; gy = e.clientY;
      glow.classList.add('active');
    });
    document.addEventListener('mouseleave', () => glow.classList.remove('active'));
    (function loop() {
      cx += (gx - cx) * 0.18;
      cy += (gy - cy) * 0.18;
      glow.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
      requestAnimationFrame(loop);
    })();
    document.querySelectorAll('[data-cursor="hover"]').forEach(el => {
      el.addEventListener('mouseenter', () => glow.classList.add('hover'));
      el.addEventListener('mouseleave', () => glow.classList.remove('hover'));
    });
  }

  /* ─── Magnetic buttons ───────────────────────────────── */
  if (!isTouch && !reduceMotion) {
    document.querySelectorAll('[data-magnetic]').forEach(el => {
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        el.style.transform = `translate(${x * 0.25}px, ${y * 0.35}px)`;
      });
      el.addEventListener('mouseleave', () => { el.style.transform = ''; });
    });
  }

  /* ─── Card tilt ──────────────────────────────────────── */
  if (!isTouch && !reduceMotion) {
    document.querySelectorAll('[data-tilt]').forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `perspective(900px) rotateY(${px * 4}deg) rotateX(${-py * 4}deg) translateY(-4px)`;
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
  }

  /* ─── FAQ: accordion (close others) ──────────────────── */
  const faqItems = document.querySelectorAll('.faq__item');
  faqItems.forEach(item => {
    item.addEventListener('toggle', () => {
      if (item.open) faqItems.forEach(o => { if (o !== item) o.open = false; });
    });
  });

  /* ─── Contact form → WhatsApp ────────────────────────── */
  const form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('name').value.trim();
      const email = document.getElementById('email').value.trim();
      const type = document.getElementById('type').value;
      const message = document.getElementById('message').value.trim();
      if (!name || !type || !message) {
        form.querySelectorAll('[required]').forEach(f => {
          if (!f.value.trim() || (f.tagName === 'SELECT' && !f.value)) {
            f.style.borderColor = 'rgba(201,168,76,0.6)';
            setTimeout(() => { f.style.borderColor = ''; }, 1500);
          }
        });
        return;
      }
      const text = encodeURIComponent(
        `Hola Lummy Designs! 👋\n\n` +
        `Mi nombre es *${name}*.\n📧 ${email}\n\n` +
        `*Tipo de pedido:* ${type}\n\n*Mi diseño:*\n${message}\n\n` +
        `¡Me gustaría más información!`
      );
      window.open(`https://wa.me/1234567890?text=${text}`, '_blank');
    });
  }

  onScroll();
})();
