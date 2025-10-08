const { config } = require('./config');

module.exports = async function assignRoles(member) {
  if (!config.features.autoAssignStudents) {
    return;
  }

  const guild = member.guild;
  console.log(`Assigning roles for: ${member.user.tag}`);

  const staffRole = guild.roles.cache.find(role => role.name === "Staff");
  const studentRole = guild.roles.cache.find(role => role.name === "Students");

  if (staffRole && member.roles.cache.has(staffRole.id)) {
    console.log(`${member.user.tag} already has the Staff role. Skipping student assignment.`);
    return;
  }

  if (studentRole) {
    try {
      await member.roles.add(studentRole);
      console.log(`Assigned Students role to ${member.user.tag}`);
    } catch (error) {
      console.error(`Failed to assign Students role to ${member.user.tag}:`, error);
    }
  } else {
    console.warn("Students role not found; skipping auto assignment.");
  }
};
