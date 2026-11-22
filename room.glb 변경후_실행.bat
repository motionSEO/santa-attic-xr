@echo off
cd /d "%~dp0"
rem room.glb (Blender export) -> KTX2 textures -> room.glb.js. Needs node + ..\_tools (npm i done once).
copy /y room.glb ..\_tools\room.src.glb >nul
node ..\_tools\ktx2room.mjs ..\_tools\room.src.glb ..\_tools\room.ktx2.glb || goto :end
node -e "const fs=require('fs');fs.writeFileSync('room.glb.js','window.ROOM_GLB_B64=\"'+fs.readFileSync('../_tools/room.ktx2.glb').toString('base64')+'\";')"
echo room.glb.js rebuilt (KTX2).
:end
pause
