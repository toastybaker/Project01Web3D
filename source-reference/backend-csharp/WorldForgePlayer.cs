using System;
using System.Collections.Generic;
using System.Linq;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.InputSystem;
using WorldForge.Core.Runtime.Gameplay;
using WorldForge.Core.Runtime.Worlds;

namespace WorldForge.Core.Networking
{
    [RequireComponent(typeof(CharacterController))]
    public sealed class WorldForgePlayer : NetworkBehaviour
    {
        [Header("Responsive locomotion")]
        [SerializeField] private float moveSpeed = 8f;
        [SerializeField] private float sprintMultiplier = 1.25f;
        [SerializeField] private float groundAcceleration = 90f;
        [SerializeField] private float groundDeceleration = 130f;
        [SerializeField] private float airAcceleration = 28f;
        [SerializeField] private float turnSpeed = 28f;
        [SerializeField] private float gravity = -24f;
        [SerializeField] private float jumpHeight = 1.1f;
        [SerializeField] private float coyoteTime = 0.12f;
        [SerializeField] private float jumpBufferTime = 0.14f;

        [Header("Interaction")]
        [SerializeField] private float interactionDistance = 5f;

        private CharacterController controller;
        private bool autoWalk;
        private bool autoGameplay;
        private bool remoteMovementReported;
        private Vector3 spawnPosition;
        private Vector3 planarVelocity;
        private float verticalVelocity;
        private float lastGroundedAt = float.NegativeInfinity;
        private float jumpQueuedUntil = float.NegativeInfinity;
        private float nextAutoInteractionAt;
        private bool autoTargetReported;
        private bool autoHeldReported;
        private bool hasWorldSpawn;
        private float nextAutoProgressAt;
        private IWorldForgeInteractable focusedInteractable;
        private WorldForgeRegionArea activeRegion;
        private float nextRegionCheckAt;
        private int observedRegionSession;
        private readonly RaycastHit[] interactionHits = new RaycastHit[24];
        private readonly Collider[] nearbyColliders = new Collider[40];
        private readonly HashSet<int> scoredInteractables = new();
        private readonly NetworkVariable<FixedString128Bytes> ownerNotice = new(
            default,
            NetworkVariableReadPermission.Owner,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> ownerNoticeRevision = new(
            0,
            NetworkVariableReadPermission.Owner,
            NetworkVariableWritePermission.Server);

        public string CurrentRegionName =>
            activeRegion != null ? activeRegion.DisplayName : string.Empty;
        public string CurrentRegionSummary =>
            activeRegion != null ? activeRegion.PublicSummary : string.Empty;
        public string FocusedInteractionPrompt =>
            focusedInteractable != null ? focusedInteractable.GetPrompt(this) : string.Empty;
        public string OwnerNotice => ownerNotice.Value.ToString();
        public int OwnerNoticeRevision => ownerNoticeRevision.Value;

        public void SetOwnerNoticeServer(string message)
        {
            if (!IsServer)
            {
                return;
            }

            ownerNotice.Value = new FixedString128Bytes(
                string.IsNullOrWhiteSpace(message)
                    ? string.Empty
                    : message[..Mathf.Min(message.Length, 120)]);
            ownerNoticeRevision.Value++;
        }

        public void TeleportOwnerServer(Vector3 position)
        {
            if (IsServer)
            {
                TeleportOwnerRpc(position);
            }
        }

        [Rpc(SendTo.Owner)]
        private void TeleportOwnerRpc(Vector3 position)
        {
            controller ??= GetComponent<CharacterController>();
            if (controller != null)
            {
                controller.enabled = false;
            }

            var networkTransform = GetComponent<OwnerNetworkTransform>();
            if (networkTransform != null && networkTransform.IsSpawned)
            {
                networkTransform.Teleport(
                    position,
                    transform.rotation,
                    transform.localScale);
            }
            else
            {
                transform.position = position;
            }
            planarVelocity = Vector3.zero;
            verticalVelocity = 0f;
            if (controller != null)
            {
                controller.enabled = true;
            }

            // Portal travel spans deliberately separated world cells. A
            // smoothed camera traversal would briefly reveal empty space and
            // neighboring cells, so every authoritative teleport snaps the
            // owner camera to the destination in the same frame.
            var cameraFollow = Camera.main != null
                ? Camera.main.GetComponent<WorldForgeCameraFollow>()
                : null;
            cameraFollow?.SetTarget(transform);
        }

        public override void OnNetworkSpawn()
        {
            controller = GetComponent<CharacterController>();
            var args = Environment.GetCommandLineArgs();
            autoWalk = args.Contains("--wf-autowalk", StringComparer.OrdinalIgnoreCase);
            autoGameplay = args.Contains("--wf-autogameplay", StringComparer.OrdinalIgnoreCase);
            spawnPosition = transform.position;

            if (!IsOwner)
            {
                return;
            }

            gameObject.name = $"Player (You - {OwnerClientId})";
            GetComponent<WorldForgeCharacterPresentation>()?.SetLocalOwner(true);
            var worldModule = WorldForge.Core.Runtime.Worlds.WorldForgeWorldModule.Current;
            transform.position = worldModule != null
                ? worldModule.GetSpawnPosition(OwnerClientId)
                : new Vector3((OwnerClientId % 4) * 1.8f - 2.7f, 1.05f, -4f);
            if (worldModule != null && worldModule.ModuleId == "project01-compact")
            {
                transform.rotation = Quaternion.identity;
            }
            spawnPosition = transform.position;
            var cameraFollow = Camera.main != null ? Camera.main.GetComponent<WorldForgeCameraFollow>() : null;
            cameraFollow?.SetTarget(transform);
            Debug.Log($"[WorldForge] WF_PLAYER_READY:{OwnerClientId}");
        }


        public void PlaceAtWorldSpawn(
            WorldForge.Core.Runtime.Worlds.WorldForgeWorldModule worldModule)
        {
            if (!IsOwner || worldModule == null)
            {
                return;
            }

            controller ??= GetComponent<CharacterController>();
            controller.enabled = false;
            var worldSpawnPosition =
                worldModule.GetSpawnPosition(OwnerClientId);
            var networkTransform = GetComponent<OwnerNetworkTransform>();
            if (networkTransform != null && networkTransform.IsSpawned)
            {
                networkTransform.Teleport(
                    worldSpawnPosition,
                    transform.rotation,
                    transform.localScale);
            }
            else
            {
                transform.position = worldSpawnPosition;
            }
            if (worldModule.ModuleId == "project01-compact")
            {
                transform.rotation = Quaternion.identity;
            }
            controller.enabled = true;
            planarVelocity = Vector3.zero;
            verticalVelocity = 0f;
            jumpQueuedUntil = float.NegativeInfinity;
            spawnPosition = transform.position;
            hasWorldSpawn = true;

            var cameraFollow = Camera.main != null
                ? Camera.main.GetComponent<WorldForgeCameraFollow>()
                : null;
            cameraFollow?.SetTarget(transform);
            Debug.Log(
                $"[WorldForge] WF_PLAYER_WORLD_SPAWN:{OwnerClientId}:{worldModule.ModuleId}:" +
                $"{transform.position:F2}");
        }

        private void Update()
        {
            if (IsServer && !IsOwner && !remoteMovementReported &&
                (transform.position - spawnPosition).sqrMagnitude > 2.25f)
            {
                remoteMovementReported = true;
                Debug.Log($"[WorldForge] WF_REMOTE_PLAYER_MOVED:{OwnerClientId}:{transform.position:F2}");
            }

            if (!IsOwner || !IsSpawned)
            {
                return;
            }

            var worldModule = WorldForge.Core.Runtime.Worlds.WorldForgeWorldModule.Current;
            if (!hasWorldSpawn)
            {
                if (worldModule != null)
                {
                    PlaceAtWorldSpawn(worldModule);
                }
                else
                {
                    verticalVelocity = 0f;
                    return;
                }
            }
            else if (!float.IsFinite(transform.position.y) ||
                     transform.position.y < spawnPosition.y - 80f)
            {
                Debug.LogWarning(
                    $"[WorldForge] Recovering player {OwnerClientId} after leaving the playable world.");
                PlaceAtWorldSpawn(worldModule);
            }

            if (autoGameplay)
            {
                UpdateAutomatedGameplay();
                return;
            }

            if (WorldForgeGameHUD.IsModalOpen)
            {
                MoveFromInput(Vector2.zero, false, false);
                return;
            }

            var keyboard = Keyboard.current;
            var gamepad = Gamepad.current;
            var input = autoWalk ? Vector2.right : Vector2.zero;
            if (!autoWalk && keyboard != null && (keyboard.wKey.isPressed || keyboard.upArrowKey.isPressed))
            {
                input.y += 1f;
            }
            if (!autoWalk && keyboard != null && (keyboard.sKey.isPressed || keyboard.downArrowKey.isPressed))
            {
                input.y -= 1f;
            }
            if (!autoWalk && keyboard != null && (keyboard.dKey.isPressed || keyboard.rightArrowKey.isPressed))
            {
                input.x += 1f;
            }
            if (!autoWalk && keyboard != null && (keyboard.aKey.isPressed || keyboard.leftArrowKey.isPressed))
            {
                input.x -= 1f;
            }

            if (!autoWalk && gamepad != null)
            {
                var stick = gamepad.leftStick.ReadValue();
                if (stick.sqrMagnitude > input.sqrMagnitude)
                {
                    input = stick;
                }
            }

            var sprint = !autoWalk &&
                         ((keyboard != null && keyboard.leftShiftKey.isPressed) ||
                          (gamepad != null &&
                           (gamepad.leftStickButton.isPressed ||
                            gamepad.rightTrigger.ReadValue() > 0.55f)));
            var jumpPressed = !autoWalk &&
                              ((keyboard != null && keyboard.spaceKey.wasPressedThisFrame) ||
                               (gamepad != null && gamepad.buttonSouth.wasPressedThisFrame));

            MoveFromInput(input, sprint, jumpPressed);
            UpdateInteractionTarget();
            UpdateRegionArrival();

            var interactPressed =
                (keyboard != null && keyboard.fKey.wasPressedThisFrame) ||
                (Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame) ||
                (gamepad != null && gamepad.buttonWest.wasPressedThisFrame);
            if (interactPressed && focusedInteractable != null)
            {
                focusedInteractable.Interact(this);
            }

            var claimPressed = Mouse.current != null &&
                               Mouse.current.rightButton.wasPressedThisFrame;
            if (claimPressed && focusedInteractable is
                    WorldForgeCompactInteractable { UsesRightClick: true } claim)
            {
                claim.InteractRightClick(this);
            }
        }

        private void MoveFromInput(Vector2 input, bool sprint, bool jumpPressed)
        {
            var planarDirection = Vector3.zero;
            if (input.sqrMagnitude >= 0.01f)
            {
                input.Normalize();
                var cameraTransform = Camera.main != null ? Camera.main.transform : transform;
                var forward = Vector3.ProjectOnPlane(cameraTransform.forward, Vector3.up).normalized;
                var right = Vector3.ProjectOnPlane(cameraTransform.right, Vector3.up).normalized;
                planarDirection = (forward * input.y + right * input.x).normalized;
            }

            if (jumpPressed)
            {
                jumpQueuedUntil = Time.time + Mathf.Max(0f, jumpBufferTime);
            }

            MoveInWorldDirection(planarDirection, sprint);
        }

        private void MoveInWorldDirection(Vector3 direction, bool sprint)
        {
            var grounded = controller.isGrounded;
            if (grounded)
            {
                lastGroundedAt = Time.time;
                if (verticalVelocity < 0f)
                {
                    verticalVelocity = -2f;
                }
            }

            var canUseQueuedJump =
                Time.time <= jumpQueuedUntil &&
                Time.time <= lastGroundedAt + Mathf.Max(0f, coyoteTime);
            if (canUseQueuedJump)
            {
                verticalVelocity = Mathf.Sqrt(
                    Mathf.Max(0.01f, jumpHeight) * -2f * gravity);
                jumpQueuedUntil = float.NegativeInfinity;
                lastGroundedAt = float.NegativeInfinity;
                grounded = false;
            }
            else if (!grounded)
            {
                verticalVelocity += gravity * Time.deltaTime;
            }

            var speed = moveSpeed * (sprint ? sprintMultiplier : 1f);
            var desiredVelocity = direction * speed;
            var acceleration = grounded
                ? direction.sqrMagnitude >= 0.01f
                    ? groundAcceleration
                    : groundDeceleration
                : airAcceleration;
            planarVelocity = Vector3.MoveTowards(
                planarVelocity,
                desiredVelocity,
                Mathf.Max(0.01f, acceleration) * Time.deltaTime);

            controller.Move(
                (planarVelocity + Vector3.up * verticalVelocity) * Time.deltaTime);
            var cameraForward = Camera.main != null
                ? Vector3.ProjectOnPlane(Camera.main.transform.forward, Vector3.up)
                : direction;
            if (cameraForward.sqrMagnitude >= 0.01f)
            {
                transform.rotation = Quaternion.Slerp(
                    transform.rotation,
                    Quaternion.LookRotation(cameraForward.normalized),
                    1f - Mathf.Exp(-turnSpeed * Time.deltaTime));
            }
        }

        private void UpdateInteractionTarget()
        {
            focusedInteractable = null;
            var cameraTransform = Camera.main != null ? Camera.main.transform : transform;
            var ray = new Ray(cameraTransform.position, cameraTransform.forward);
            var origin = transform.position + Vector3.up * 1.05f;
            var forward = Vector3.ProjectOnPlane(
                cameraTransform.forward,
                Vector3.up).normalized;
            var bestScore = float.MaxValue;
            scoredInteractables.Clear();

            var hitCount = Physics.SphereCastNonAlloc(
                ray,
                0.3f,
                interactionHits,
                interactionDistance,
                ~0,
                QueryTriggerInteraction.Collide);
            for (var i = 0; i < hitCount; i++)
            {
                if (!TryScoreInteractionCandidate(
                        interactionHits[i].collider,
                        origin,
                        forward,
                        true,
                        out var candidate,
                        out var score) ||
                    score >= bestScore)
                {
                    continue;
                }

                bestScore = score;
                focusedInteractable = candidate;
            }

            var nearbyCount = Physics.OverlapSphereNonAlloc(
                origin,
                interactionDistance,
                nearbyColliders,
                ~0,
                QueryTriggerInteraction.Collide);
            for (var i = 0; i < nearbyCount; i++)
            {
                if (!TryScoreInteractionCandidate(
                        nearbyColliders[i],
                        origin,
                        forward,
                        false,
                        out var candidate,
                        out var score) ||
                    score >= bestScore)
                {
                    continue;
                }

                bestScore = score;
                focusedInteractable = candidate;
            }
        }

        private bool TryScoreInteractionCandidate(
            Collider collider,
            Vector3 origin,
            Vector3 forward,
            bool directlyAimed,
            out IWorldForgeInteractable candidate,
            out float score)
        {
            candidate = FindInteractable(collider);
            score = float.MaxValue;
            if (candidate == null)
            {
                return false;
            }

            var component = candidate as Component;
            var candidateId = component != null
                ? component.GetInstanceID()
                : collider.GetInstanceID();
            if (!scoredInteractables.Add(candidateId))
            {
                return false;
            }

            var rootPoint = component != null
                ? component.transform.position
                : collider.bounds.center;
            var rootOffset = Vector3.ProjectOnPlane(
                rootPoint - origin,
                Vector3.up);
            if (rootOffset.magnitude > interactionDistance + 0.35f)
            {
                return false;
            }

            var point = collider.ClosestPoint(origin);
            var offset = Vector3.ProjectOnPlane(point - origin, Vector3.up);
            var distance = offset.magnitude;
            var facing = offset.sqrMagnitude < 0.01f
                ? 1f
                : Vector3.Dot(forward, offset.normalized);
            if (distance > 1.35f && facing < 0.34f)
            {
                return false;
            }

            if (!HasInteractionLineOfSight(collider, candidate, origin))
            {
                return false;
            }

            score =
                distance * 0.58f +
                (1f - facing) * 3.4f +
                (directlyAimed ? -1.15f : 0f);
            return true;
        }

        private static bool HasInteractionLineOfSight(
            Collider candidateCollider,
            IWorldForgeInteractable candidate,
            Vector3 origin)
        {
            var target = candidateCollider.bounds.center;
            var offset = target - origin;
            var distance = offset.magnitude;
            if (distance <= 0.05f)
            {
                return true;
            }

            if (!Physics.Raycast(
                    origin,
                    offset / distance,
                    out var obstruction,
                    distance + 0.08f,
                    ~0,
                    QueryTriggerInteraction.Ignore))
            {
                return true;
            }

            if (obstruction.collider == candidateCollider)
            {
                return true;
            }

            var component = candidate as Component;
            return component != null &&
                   (obstruction.transform == component.transform ||
                    obstruction.transform.IsChildOf(component.transform));
        }

        private void UpdateRegionArrival()
        {
            var round = WorldForgeRoundDirector.Current;
            if (round == null || !round.IsRoundActive)
            {
                activeRegion = null;
                observedRegionSession = 0;
                return;
            }

            if (observedRegionSession != round.SessionNumber)
            {
                activeRegion = null;
                observedRegionSession = round.SessionNumber;
                nextRegionCheckAt = 0f;
            }

            if (Time.unscaledTime < nextRegionCheckAt)
            {
                return;
            }

            nextRegionCheckAt = Time.unscaledTime + 0.25f;
            var next = WorldForgeRegionArea.FindNearestContaining(transform.position);
            if (next == activeRegion)
            {
                return;
            }

            activeRegion = next;
            if (activeRegion == null)
            {
                return;
            }

            WorldForgeRegionalProgression.Current?.RequestRegionArrival(
                this,
                activeRegion.RegionId);
            Debug.Log(
                $"[WorldForge] WF_LOCAL_REGION_ENTERED:{activeRegion.RegionId}:" +
                $"{activeRegion.DisplayName}");
        }

        private void UpdateAutomatedGameplay()
        {
            var objective = WorldForgeSharedObjective.Current;
            if (objective != null && objective.IsComplete)
            {
                MoveInWorldDirection(Vector3.zero, false);
                return;
            }

            var held = WorldForgeCarryable.FindHeldBy(OwnerClientId);
            var available = WorldForgeCarryable.FindAvailable();
            if (!autoTargetReported && available != null)
            {
                autoTargetReported = true;
                Debug.Log($"[WorldForge] WF_AUTO_TARGET_READY:{available.NetworkObjectId}");
            }
            if (!autoHeldReported && held != null)
            {
                autoHeldReported = true;
                Debug.Log(
                    $"[WorldForge] WF_AUTO_CARRY_ROUTE:{held.NetworkObjectId}:{(objective != null ? "ready" : "missing")}");
            }
            var targetPosition = held != null && objective != null
                ? objective.DeliveryPoint
                : available != null
                    ? available.transform.position
                    : transform.position;
            var offset = Vector3.ProjectOnPlane(targetPosition - transform.position, Vector3.up);
            var distance = offset.magnitude;
            MoveInWorldDirection(distance > 0.15f ? offset.normalized : Vector3.zero, false);

            if (Time.unscaledTime >= nextAutoProgressAt)
            {
                nextAutoProgressAt = Time.unscaledTime + 2f;
                Debug.Log(
                    $"[WorldForge] WF_AUTO_PROGRESS:{(held != null ? "carry" : "seek")}:{transform.position:F2}:{targetPosition:F2}:{distance:F2}");
            }

            if (held == null && available != null && distance <= interactionDistance &&
                Time.unscaledTime >= nextAutoInteractionAt)
            {
                available.Interact(this);
                nextAutoInteractionAt = Time.unscaledTime + 1f;
            }
        }

        private void OnGUI()
        {
            if (WorldForgeGameHUD.IsActive ||
                !IsOwner || autoGameplay || focusedInteractable == null)
            {
                return;
            }

            var prompt = focusedInteractable.GetPrompt(this);
            if (string.IsNullOrWhiteSpace(prompt))
            {
                return;
            }

            var style = new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.MiddleCenter,
                fontSize = 16,
                fontStyle = FontStyle.Bold,
                normal = { textColor = new Color(0.96f, 0.94f, 0.82f) }
            };
            var rect = new Rect(Screen.width * 0.5f - 240f, Screen.height - 84f, 480f, 40f);
            GUI.Label(new Rect(rect.x + 2f, rect.y + 2f, rect.width, rect.height),
                $"E   {prompt}",
                new GUIStyle(style)
                {
                    normal = { textColor = new Color(0f, 0f, 0f, 0.9f) }
                });
            GUI.Label(rect, $"E   {prompt}", style);
        }

        private static IWorldForgeInteractable FindInteractable(Collider targetCollider)
        {
            var behaviours = targetCollider.GetComponentsInParent<MonoBehaviour>(true);
            return behaviours.OfType<IWorldForgeInteractable>().FirstOrDefault();
        }

    }
}
