const { Colors } = require("discord.js");
const { config } = require('./config');

module.exports = async function ensureRolesForGuild(guild) {
  console.log(`Ensuring roles for guild: ${guild.name}`);

  let staffRole = guild.roles.cache.find(role => role.name === "Staff") || null;
  let studentRole = guild.roles.cache.find(role => role.name === "Students") || null;

  if (config.features.autoCreateCoreRoles) {
    if (!staffRole) {
      try {
        staffRole = await guild.roles.create({
          name: "Staff",
          color: Colors.Red,
          reason: "Creating Staff role for queue management.",
        });
        console.log("Staff role created successfully.");
      } catch (error) {
        console.error("Failed to create Staff role:", error);
      }
    } else {
      console.log("Staff role already exists.");
    }

    if (!studentRole) {
      try {
        studentRole = await guild.roles.create({
          name: "Students",
          color: Colors.Blue,
          reason: "Creating Students role.",
        });
        console.log("Students role created successfully.");
      } catch (error) {
        console.error("Failed to create Students role:", error);
      }
    } else {
      console.log("Students role already exists.");
    }
  } else if (!staffRole || !studentRole) {
    console.log('Auto role creation is disabled. Existing roles were not modified.');
  }

  if (!config.features.autoAssignStudents || !studentRole) {
    return { staffRole, studentRole };
  }

  // Assign Students role to any unassigned users (excluding bots)
  try {
    // Fetch all members of the guild
    const members = await guild.members.fetch();
    members.forEach(async member => {
      // Skip bots
      if (member.user.bot) return;

      // If the member doesn't have either the Students or Staff role, assign Students
      if (!member.roles.cache.has(studentRole.id) && !member.roles.cache.has(staffRole.id)) {
        try {
          await member.roles.add(studentRole);
          console.log(`Assigned Students role to ${member.user.tag}`);
        } catch (error) {
          console.error(`Failed to assign Students role to ${member.user.tag}:`, error);
        }
      }
    });
  } catch (error) {
    console.error("Error fetching guild members:", error);
  }
  return { staffRole, studentRole };
};
