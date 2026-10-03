// Read the installed package version; never duplicate the release number in UI code.
function displayInstalledVersion(){
  const version=globalThis.chrome?.runtime?.getManifest?.().version;
  for(const badge of document.querySelectorAll('[data-app-version]')){
    badge.hidden=!version;
    if(version){badge.textContent='v'+version;badge.setAttribute('aria-label',(document.documentElement.lang.startsWith('zh') ? '当前扩展版本':'Installed extension version')+' '+version);}
  }
}
displayInstalledVersion();
window.addEventListener('wescreen-language',displayInstalledVersion);
