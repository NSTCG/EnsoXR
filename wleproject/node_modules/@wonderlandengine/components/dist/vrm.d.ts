import { Component } from '@wonderlandengine/api';
import { quat } from 'gl-matrix';
import { Object3D } from '@wonderlandengine/api';
interface HumanoidBones {
    [key: string]: Object3D | null;
    hips: Object3D | null;
    spine: Object3D | null;
    chest: Object3D | null;
    upperChest: Object3D | null;
    neck: Object3D | null;
    head: Object3D | null;
    leftEye: Object3D | null;
    rightEye: Object3D | null;
    jaw: Object3D | null;
    leftUpperLeg: Object3D | null;
    leftLowerLeg: Object3D | null;
    leftFoot: Object3D | null;
    leftToes: Object3D | null;
    rightUpperLeg: Object3D | null;
    rightLowerLeg: Object3D | null;
    rightFoot: Object3D | null;
    rightToes: Object3D | null;
    leftShoulder: Object3D | null;
    leftUpperArm: Object3D | null;
    leftLowerArm: Object3D | null;
    leftHand: Object3D | null;
    rightShoulder: Object3D | null;
    rightUpperArm: Object3D | null;
    rightLowerArm: Object3D | null;
    rightHand: Object3D | null;
    leftThumbMetacarpal: Object3D | null;
    leftThumbProximal: Object3D | null;
    leftThumbDistal: Object3D | null;
    leftIndexProximal: Object3D | null;
    leftIndexIntermediate: Object3D | null;
    leftIndexDistal: Object3D | null;
    leftMiddleProximal: Object3D | null;
    leftMiddleIntermediate: Object3D | null;
    leftMiddleDistal: Object3D | null;
    leftRingProximal: Object3D | null;
    leftRingIntermediate: Object3D | null;
    leftRingDistal: Object3D | null;
    leftLittleProximal: Object3D | null;
    leftLittleIntermediate: Object3D | null;
    leftLittleDistal: Object3D | null;
    rightThumbMetacarpal: Object3D | null;
    rightThumbProximal: Object3D | null;
    rightThumbDistal: Object3D | null;
    rightIndexProximal: Object3D | null;
    rightIndexIntermediate: Object3D | null;
    rightIndexDistal: Object3D | null;
    rightMiddleProximal: Object3D | null;
    rightMiddleIntermediate: Object3D | null;
    rightMiddleDistal: Object3D | null;
    rightRingProximal: Object3D | null;
    rightRingIntermediate: Object3D | null;
    rightRingDistal: Object3D | null;
    rightLittleProximal: Object3D | null;
    rightLittleIntermediate: Object3D | null;
    rightLittleDistal: Object3D | null;
}
/**
 * Component for loading and handling VRM 1.0 models.
 *
 * Posing of the model should be done exclusively by rotating the bones. These can be
 * accessed using the `.bones` property and follow the VRM bone naming. Note that not
 * all VRM models will have all possible bones. The rest pose (T-pose) is captured in
 * the `.restPose` property. Resetting a bone to its rest pose can be done as follows:
 * ```js
 * vrmComponent.bones[vrmBoneName].rotationLocal = vrmComponent.restPose[vrmBoneName];
 * ```
 *
 * Moving the model through the world should be done by moving the object this component
 * is attached to. In other words, by moving the root of the VRM model. The bones and any
 * descendant objects should *not* be used to move the VRM model.
 *
 * The core extension `VRMC_vrm` as well as the`VRMC_springBone` and `VRMC_node_constraint`
 * extensions are supported.
 *
 * **Limitations:**
 * - No support for `VRMC_material_mtoon`
 * - Expressions aren't supported
 * - Expression based lookAt isn't supported
 * - Mesh annotation mode `auto` is not supported (first person mode)
 */
export declare class Vrm extends Component {
    static TypeName: string;
    /** URL to a VRM file to load */
    src: string;
    /** Object the VRM is looking at */
    lookAtTarget: Object3D | null;
    /** Meta information about the VRM model */
    meta: any;
    /** The humanoid bones of the VRM model */
    bones: HumanoidBones;
    /** Rotations of the bones in the rest pose (T-pose) */
    restPose: {
        [key: string]: quat;
    };
    private _nodeConstraints;
    private _springChains;
    private _sphereColliders;
    private _capsuleColliders;
    private _firstPersonAnnotations;
    private _lookAt;
    private _initialized;
    private _tempV3;
    private _tempV3A;
    private _tempV3B;
    private _tempQuat;
    private _tempQuatA;
    private _tempQuatB;
    private _tempQuat2;
    private _tailToShape;
    private _headToTail;
    private _inertia;
    private _stiffness;
    private _external;
    private _identityQuat;
    start(): Promise<void>;
    /**
     * Parses the VRM glTF extensions and initializes the vrm component.
     * @param extensions The glTF extensions for the VRM model
     */
    private _initializeVrm;
    private _parseHumanoid;
    private _parseFirstPerson;
    private _parseLookAt;
    private _findAndParseNodeConstraints;
    private _parseAndInitializeSpringBones;
    update(dt: number): void;
    private _rangeMap;
    private _resolveLookAt;
    private _resolveConstraints;
    private _resolveConstraint;
    private _updateSpringBones;
    /**
     * @param firstPerson Whether the model should render for first person or third person views
     */
    set firstPerson(firstPerson: boolean);
}
export {};
