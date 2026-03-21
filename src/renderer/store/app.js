import { defineStore } from "pinia";

const state = () => ({
  sidebarStatus: {
    opened: !+localStorage.getItem("sidebarStatus"),
    withoutAnimation: false,
  },
  device: "desktop",
  isRoute: "/",
  showLogingData: [],
  showLogingDataStatus:localStorage.getItem("showLogingDataStatus")?JSON.parse(localStorage.getItem("showLogingDataStatus")):[],
});

export const useAppStore = defineStore({
  id: "app",
  state,
  actions: {
    setData(key, val) {
      this[key] = val;
    },
    addLoginData(data) {
      data["showLoginDialog"] = true;
      this.showLogingData.push(data);
    },
    clearLoginData() {
      this.showLogingDataStatus = [];
      localStorage.setItem("showLogingDataStatus",JSON.stringify(this.showLogingDataStatus));
    },
    addLoginDataStatus(data) {
      this.showLogingDataStatus.push(data);
      localStorage.setItem("showLogingDataStatus",JSON.stringify(this.showLogingDataStatus));
    },
    delLoginData(index) {
      this.showLogingData.splice(index, 1);
    },
    ToggleSideBar() {
      if (this.sidebarStatus.opened) {
        localStorage.setItem("sidebarStatus", 1);
      } else {
        localStorage.setItem("sidebarStatus", 0);
      }
      this.sidebarStatus.opened = !this.sidebarStatus.opened;
    },
    CloseSideBar({ withoutAnimation }) {
      localStorage.setItem("sidebarStatus", 1);
      this.sidebarStatus.opened = false;
      this.sidebarStatus.withoutAnimation = withoutAnimation;
    },
  },
});
