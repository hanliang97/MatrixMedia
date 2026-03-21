import { getCurrentInstance } from 'vue'
export const useRoute = () => {
    return getCurrentInstance()?.proxy.$route
}
export const useRouter = () => {
    return getCurrentInstance()?.proxy.$router
}