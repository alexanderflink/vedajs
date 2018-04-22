import * as THREE from 'three';
import { IPassModel } from './constants';

declare const require: any;
require('three-obj-loader')(THREE); // tslint:disable-line

interface IConstructable<T> {
    new (): T;
}
const MTLLoader: IConstructable<THREE.MTLLoader> = require('three-mtl-loader'); // tslint:disable-line

interface ICache {
    url: string;
    obj: THREE.Object3D;
}

export default class ModelLoader {
    private cache: { [url: string]: ICache | null } = {};

    private objLoader = new THREE.OBJLoader();
    private mtlLoader = new MTLLoader();
    private objectLoader = new THREE.ObjectLoader();
    private jsonLoader = new THREE.JSONLoader();

    async load(model: IPassModel): Promise<THREE.Object3D> {
        const url = model.PATH;
        const key = `${model.PATH}:${model.MATERIAL || '_'}`;

        const cache = this.cache[key];
        if (cache) {
            return Promise.resolve(cache.obj);
        }

        let obj;
        if (/\.obj\/?$/.test(url)) {
            obj = await this.loadObjAndMtl(model);
        } else if (/\.js(on)?\/?$/.test(url)) {
            obj = await this.loadJson(model);
        } else {
            throw new TypeError('Unsupported model URL: ' + url);
        }

        obj = this.fixObj(obj);
        this.cache[url] = { url, obj };
        console.log(obj);
        return obj;
    }

    private async loadJson(model: IPassModel): Promise<THREE.Object3D> {
        const obj = await Promise.race([
            new Promise<THREE.Object3D>((resolve, reject) => {
                this.jsonLoader.load(
                    model.PATH,
                    (geometry, materials) => {
                        const material = materials[0];
                        resolve(new THREE.Mesh(geometry, material));
                    },
                    undefined,
                    reject,
                );
            }),
            new Promise<THREE.Object3D>((resolve, reject) => {
                this.objectLoader.load(model.PATH, resolve, undefined, reject);
            }),

            // timeout
            new Promise<THREE.Object3D>((_resolve, reject) => {
                setTimeout(() => reject('Request Timeout'), 50000);
            }),
        ]);

        if (
            obj instanceof THREE.Mesh &&
            obj.geometry instanceof THREE.Geometry
        ) {
            obj.geometry = new THREE.BufferGeometry().fromGeometry(
                obj.geometry,
            );
        }

        const group = new THREE.Group();
        group.add(obj);

        return group;
    }

    private async loadObjAndMtl(model: IPassModel): Promise<THREE.Object3D> {
        if (model.MATERIAL) {
            const materials = await this.loadMtl(model.MATERIAL);
            console.log(materials);
            materials.preload();
            this.objLoader.setMaterials(materials);
        } else {
            this.objLoader.setMaterials(null as any);
        }

        return this.loadObj(model.PATH);
    }

    private loadMtl(url: string): Promise<THREE.MaterialCreator> {
        const match = url.match(/^(.*\\)(.*)$/) || url.match(/^(.*\/)(.*)\/?$/); // windows local file // other
        if (!match) {
            return Promise.reject(new TypeError('Invalid URL: ' + url));
        }

        const [, path, basename] = match;
        this.mtlLoader.setPath(path);
        return new Promise((resolve, reject) => {
            this.mtlLoader.load(basename, resolve, undefined, reject);
        });
    }

    private loadObj(url: string): Promise<THREE.Group> {
        return new Promise((resolve, reject) => {
            this.objLoader.load(url, resolve, undefined, reject);
        });
    }

    private fixObj(obj: THREE.Object3D) {
        let box: THREE.Box3 | null = null;
        obj.traverse(o => {
            if (
                o instanceof THREE.Mesh &&
                o.geometry instanceof THREE.BufferGeometry
            ) {
                o.geometry.computeBoundingBox();

                if (box === null) {
                    box = o.geometry.boundingBox;
                } else {
                    box.union(o.geometry.boundingBox);
                }
            }
        });

        // Return if children is empty
        if (box === null) {
            return obj;
        }

        const sphere = new THREE.Sphere();
        box!.getBoundingSphere(sphere);
        const scale = 1 / sphere.radius;
        const offset = sphere.center;

        obj.traverse(o => {
            if (
                o instanceof THREE.Mesh &&
                o.geometry instanceof THREE.BufferGeometry
            ) {
                o.geometry.translate(-offset.x, -offset.y, -offset.z);
                o.geometry.scale(scale, scale, scale);
                o.updateMatrix();
            }
        });

        return obj;
    }
}