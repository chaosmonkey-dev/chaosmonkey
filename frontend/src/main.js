import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router/index.ts'
import { pinia } from './stores'

const app = createApp(App)

app.use(router)
app.use(pinia)

// Set the page title
document.title = 'ChaosMonkey.dev - Engineering Dashboard'

app.mount('#app')
