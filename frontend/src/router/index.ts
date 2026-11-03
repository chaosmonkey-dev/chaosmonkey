import { createRouter, createWebHistory } from 'vue-router'

function isAuthenticated(): boolean {
  const token = localStorage.getItem('api_token')
  return !!(token && token !== 'oauth_authenticated' && token.trim() !== '')
}

const routes = [
  {
    path: '/',
    redirect: to => {
      if (!isAuthenticated()) {
        return { path: '/login' }
      }
      // Preserve existing query params and ensure v2=1
      const query = { ...to.query, v2: '1' }
      return { path: '/dashboards', query }
    }
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../pages/Login.vue')
  },
  {
    path: '/enroll/:token',
    name: 'Enroll',
    component: () => import('../pages/Enroll.vue')
  },
  {
    path: '/invite/:token',
    name: 'Invite',
    component: () => import('../pages/Invite.vue')
  },
  {
    path: '/accept-invite/:token',
    name: 'AcceptInvite',
    component: () => import('../pages/AcceptInvite.vue')
  },
  {
    path: '/callback',
    name: 'OAuthCallback',
    component: () => import('../pages/OAuthCallback.vue')
  },
  {
    path: '/connect',
    name: 'ConnectIDEs',
    component: () => import('../pages/ConnectIDEs.vue')
  },
  {
    path: '/dashboards',
    name: 'Dashboards',
    component: () => import('../pages/Dashboards.vue'),
    beforeEnter: (to) => {
      // Ensure v2=1 is always present, preserve other query params
      if (to.query.v2 !== '1') {
        const query = { ...to.query, v2: '1' }
        return { path: '/dashboards', query, replace: true }
      }
    }
  },
  {
    path: '/metrics',
    name: 'Metrics',
    component: () => import('../pages/Metrics.vue')
  },
  {
    path: '/unified-smoke-test',
    name: 'UnifiedSmokeTest',
    component: () => import('../pages/UnifiedSmokeTest.vue'),
    meta: { devOnly: true }
  },
  {
    path: '/labs/perf-insights',
    name: 'LabsPerfInsights',
    component: () => import('../pages/LabsPerfInsights.vue')
  },
  {
    path: '/labs/perf-insights-json',
    name: 'LabsPerfInsightsJSON',
    component: () => import('../pages/LabsPerfInsightsJSON.vue'),
    meta: { devOnly: true }
  },
  {
    path: '/labs/filter-test',
    name: 'FilterTest',
    component: () => import('../pages/FilterTest.vue'),
    meta: { devOnly: true }
  },
  {
    path: '/manage-teams',
    redirect: { path: '/settings', query: { tab: 'team' } }
  },
  {
    // Pilot Ops 26: placeholder billing is not customer-visible on live
    // pilots. ManageBilling.vue stays in the tree (dormant) but is no
    // longer routed — direct navigation lands on the authenticated
    // dashboards surface, mirroring the /manage-teams redirect pattern.
    path: '/manage-billing',
    redirect: { path: '/dashboards', query: { v2: '1' } }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../pages/Settings.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// Navigation guard - auth-aware routing for pilot deployments
router.beforeEach((to, from, next) => {
  const authed = isAuthenticated()

  // Public routes that don't require auth
  const publicRoutes = ['/login', '/callback']
  const isPublicRoute = publicRoutes.includes(to.path) ||
    to.path.startsWith('/enroll/') ||
    to.path.startsWith('/invite/') ||
    to.path.startsWith('/accept-invite/')

  // If authenticated and trying to access login, redirect to dashboards
  if (to.path === '/login' && authed) {
    next('/dashboards?v2=1')
    return
  }

  // Allow public routes (invite/enroll/callback) regardless of auth
  if (isPublicRoute) {
    next()
    return
  }

  // Redirect obsolete onboarding routes to dashboards (if authed) or login
  if (to.path === '/connect' || to.path === '/metrics') {
    next(authed ? '/dashboards?v2=1' : '/login')
    return
  }

  // Protect dashboards and other app routes
  if (!authed && (to.path === '/dashboards' || to.path === '/')) {
    next('/login')
    return
  }

  // Allow labs and management routes (they handle their own auth state)
  if (to.path.startsWith('/labs/') || to.path === '/unified-smoke-test' || to.path === '/manage-billing' || to.path === '/settings') {
    next()
    return
  }

  // Allow all other routes
  next()
})

export default router
