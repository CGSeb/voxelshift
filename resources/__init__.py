'''
Copyright (C) 2024
contact@voxelshift.store

Created by CG Seb

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
'''

import bpy
import json
import os
from bpy.app.handlers import persistent
from datetime import datetime

json_file_path = os.path.join(os.path.dirname(os.path.realpath(__file__)), "./VoxelShift.json")

@persistent
def recent_blender_saved(_):
    if bpy.data.filepath == "" or bpy.data.filepath is None:
        return
    
    file = open(json_file_path, "r+")
    data = json.load(file)
    file.close()

    data['blenderProjects'] |= {bpy.data.filepath: datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
    file = open(json_file_path, "w+")
    json.dump(data, file)

    previous_render_path = bpy.context.scene.render.filepath
    previous_render_res_x = bpy.context.scene.render.resolution_x
    previous_render_res_y = bpy.context.scene.render.resolution_y
    previous_render_format = bpy.context.scene.render.image_settings.file_format

    render_name = "VS_THUMB_"+ os.path.basename(bpy.data.filepath).replace(".blend", "")
    bpy.context.scene.render.filepath = os.path.join(os.path.dirname(os.path.realpath(__file__)), render_name)
    bpy.context.scene.render.resolution_x = 256
    bpy.context.scene.render.resolution_y = 256
    bpy.context.scene.render.image_settings.file_format = 'JPEG'

    bpy.ops.render.opengl(write_still=True)

    bpy.context.scene.render.filepath = previous_render_path
    bpy.context.scene.render.resolution_x = previous_render_res_x
    bpy.context.scene.render.resolution_y = previous_render_res_y
    bpy.context.scene.render.image_settings.file_format = previous_render_format

def register():
    if not os.path.exists(json_file_path):
        file = open(json_file_path, 'w')
        file.write('{"lastOpen": null, "blenderProjects": {}}')
        file.close()

        return

    file = open(json_file_path , "r+")
    data = json.load(file)
    file.close()
    data['lastOpen'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    file = open(json_file_path , "w+")
    json.dump(data, file)

    if not recent_blender_saved in bpy.app.handlers.save_post:
        bpy.app.handlers.save_post.append(recent_blender_saved)


def unregister():
    print('Unregister')


if __name__ == "__main__":
    register()