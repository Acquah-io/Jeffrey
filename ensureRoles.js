const { PermissionsBitField, Colors } = require("discord.js");

module.exports = async function ensureRolesForGuild(guild) {
  console.log(`Ensuring roles for guild: ${guild.name}`);

  // Check Staff role
  let staffRole = guild.roles.cache.find(role => role.name === "Staff");
  if (!staffRole) {
    try {
      staffRole = await guild.roles.create({
        name: "Staff",
        color: Colors.Red,
        permissions: [PermissionsBitField.Flags.Administrator],
        reason: "Creating Staff role with admin permissions.",
      });
      console.log("Staff role created successfully.");
    } catch (error) {
      console.error("Failed to create Staff role:", error);
    }
  } else {
    console.log("Staff role already exists.");
  }

  // Check Students role
  let studentRole = guild.roles.cache.find(role => role.name === "Students");
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
};