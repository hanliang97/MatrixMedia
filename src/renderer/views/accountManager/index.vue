<template>
  <div class="relative">
    <div style="position: fixed; z-index: 9999; left: 40%; top: 40px">
      <el-button type="danger">{{ partition.split('-')[0] }}</el-button>
      <el-button @click="resetPage">重载页面</el-button>
     <el-button @click="deleteData">删除账号</el-button> 
    </div>
    <webview v-if="src" :src="src" style="display: flex; width: 100%" webpreferences="javascript=yes" :httpreferrer="src" nodeintegrationinsubframes disablewebsecurity :style="{ height: windowHeight + 'px' }" allowpopups :partition="partition.split('-')[0]" :key="partition.split('-')[0]" :useragent="ptConfig[title].useragent" ref="webviewRef"></webview>
  </div>
</template>

<script>
import { ipcRenderer } from "electron";
import ptConfig from "@/utils/configUrl";
import dataRequest from "@/utils/dataRequest";
import { usePermissionStore } from "@/store/permission";
import { useAppStore } from "@/store/app";

export default {
  data() {
    return {
      ptConfig,
      windowHeight: window.innerHeight,
      partition: "persist:",
      src: "",
      title: "",
      urldata: {},
    };
  },

  mounted() {
    window.addEventListener("resize", () => {
      this.windowHeight = window.innerHeight - 100;
    });
    this.partition += this.$route.meta.phone.split('-')[0] + this.$route.meta.title;
    this.src = this.$route.meta.url;
    this.urldata = this.$route.meta;
    this.title = this.$route.meta.title;
    console.log(this.$route.meta);
    ipcRenderer.invoke("puppeteerFile", { partition: this.partition, url: this.ptConfig[this.title].upload ,pt: this.title+'登录' }).then((res) => {
      console.log(res, "登录状态");
    });
    setTimeout(() => {
         this.$refs.webviewRef.addEventListener("dom-ready", () => {
      this.$refs.webviewRef.executeJavaScript(`
       var script = document.createElement('script');
        script.src = 'http://localhost:30088/vconsole.js';
        document.head.appendChild(script);
        script.onload = function() {
          new window.VConsole();
        }; 
      `);
    });
    }, 1000);
  },
  beforeDestroy() {
  },
  methods: {
    resetPage() {
      this.$refs.webviewRef.reload();
    },
    deleteData() {
      this.$confirm("此操作将永久删除该数据, 是否继续?", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning",
      }).then(() => {
        dataRequest({
          type: "delete",
          fileName: "account",
          item: this.urldata,
        }).then(() => {
          this.$message({
            type: "success",
            message: "删除成功!",
          });
          
          usePermissionStore().GenerateRoutes().then(() => {
            setTimeout(() => {
              const accountRoutes = this.$router.getRoutes().filter(route =>
                typeof route.path === 'string' && route.path.startsWith('/accountManager')
              );
              if (accountRoutes.length > 0) {
                const targetPath = accountRoutes[0].path;
                if (this.$route.path !== targetPath) {
                  this.$router.push(targetPath);
                }
                useAppStore().setData('isRoute', 'accountManager');
              } else {
                this.$router.push('/');
                useAppStore().setData('isRoute', '/');
              }
            }, 200);
          });
        });
      });
    },
  },
};
</script>

