/* ============================================================
   LUMMY DESIGNS — Main JavaScript
   ============================================================ */

(function () {
  'use strict';

  // ─── Navbar scroll behavior ──────────────────────────────
  const navbar = document.getElementById('navbar');

  function onScroll() {
    if (window.scrollY > 80) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
    updateActiveLink();
  }

  window.addEventListener('scroll', onScroll, { passive: true });

  // ─── Mobile menu ─────────────────────────────────────────
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('navLinks');

  hamburger.addEventListener('click', () => {
    const isOpen = hamburger.classList.toggle('open');
    navLinks.classList.toggle('open', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('open');
      navLinks.classList.remove('open');
      document.body.style.overflow = '';
    });
  });

  // Close menu on outside click
  document.addEventListener('click', (e) => {
    if (navLinks.classList.contains('open') &&
        !navLinks.contains(e.target) &&
        !hamburger.contains(e.target)) {
      hamburger.classList.remove('open');
      navLinks.classList.remove('open');
      document.body.style.overflow = '';
    }
  });

  // ─── Active nav link on scroll ───────────────────────────
  const sections    = document.querySelectorAll('section[id]');
  const allNavLinks = document.querySelectorAll('.nav__link');

  function updateActiveLink() {
    let current = '';
    sections.forEach(section => {
      if (window.scrollY >= section.offsetTop - 220) {
        current = section.id;
      }
    });
    allNavLinks.forEach(link => {
      const href = link.getAttribute('href');
      link.classList.toggle('active', href === `#${current}`);
    });
  }

  // ─── Scroll reveal (Intersection Observer) ───────────────
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;

      const el      = entry.target;
      const parent  = el.parentElement;
      const siblings = Array.from(parent.querySelectorAll('.reveal'));
      const idx     = siblings.indexOf(el);

      el.style.transitionDelay = `${idx * 0.1}s`;
      el.classList.add('visible');
      revealObserver.unobserve(el);
    });
  }, {
    threshold: 0.08,
    rootMargin: '0px 0px -50px 0px',
  });

  document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

  // ─── Hero parallax ───────────────────────────────────────
  const heroBg = document.querySelector('.hero__bg');
  if (heroBg && window.innerWidth > 768) {
    window.addEventListener('scroll', () => {
      const scrolled = window.scrollY;
      if (scrolled < window.innerHeight) {
        heroBg.style.transform = `translateY(${scrolled * 0.28}px)`;
      }
    }, { passive: true });
  }

  // ─── Smooth scroll for anchor links ──────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (!target) return;
      e.preventDefault();
      const navHeight = navbar.offsetHeight;
      const targetTop = target.getBoundingClientRect().top + window.scrollY - navHeight - 20;
      window.scrollTo({ top: targetTop, behavior: 'smooth' });
    });
  });

  // ─── Contact form → WhatsApp ──────────────────────────────
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const name    = document.getElementById('name').value.trim();
      const email   = document.getElementById('email').value.trim();
      const type    = document.getElementById('type').value;
      const message = document.getElementById('message').value.trim();

      if (!name || !type || !message) return;

      const text = encodeURIComponent(
        `Hola Lummy Designs! 👋\n\n` +
        `Mi nombre es *${name}*.\n` +
        `📧 ${email}\n\n` +
        `*Tipo de pedido:* ${type}\n\n` +
        `*Mi diseño:*\n${message}\n\n` +
        `¡Me gustaría saber más información!`
      );

      window.open(`https://wa.me/1234567890?text=${text}`, '_blank');
    });
  }

  // ─── Gallery: touch device hover fallback ────────────────
  const isTouchDevice = () => window.matchMedia('(hover: none)').matches;
  if (isTouchDevice()) {
    document.querySelectorAll('.gallery__item').forEach(item => {
      item.addEventListener('click', () => {
        item.classList.toggle('touch-active');
      });
    });
  }

  // ─── Initial call ─────────────────────────────────────────
  onScroll();

})();
